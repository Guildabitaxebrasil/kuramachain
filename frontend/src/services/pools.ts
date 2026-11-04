/**
 * Leitura de pools.
 *
 * - **KuramaChain**: `KurFactory.allPairs(i)` → `KurPair` (reservas, LP supply,
 *   saldo do usuário). Tudo real, inclusive TVL (reservas × preço on-chain).
 * - **Redes públicas**: pools Uniswap V3 descobertos via `factory.getPool` para
 *   os pares token ↔ âncora (stable/wrapped) e TVL lido do saldo do pool.
 * - **Volume**: eventos `Swap` do par (`eth_getLogs`), em janela de blocos
 *   calculada pelo tempo médio de bloco da rede.
 */
import type { PairTrade, PoolInfo, TokenMeta } from '../types/defi';
import { EVT, FN } from '../abi/selectors';
import { encodeBalanceOf, isZeroAddress, sameAddress } from '../abi/coders';
import { ethCall, getBlockNumber, readAddress, readString, readUint, rpc } from './rpc';
import { contractAddress } from '../contracts/registry';
import { findToken, isNativeToken, tokensForChain } from '../tokens/registry';
import { getChain, KURAMA_CHAIN_ID } from '../chains/chains';
import { findV3Pool, getPrices, readV3PoolPrice } from './prices';

const KUR_POOL_CAP = 80;
const V3_POOL_CAP = 12;
const TRADE_LOG_CAP = 400;

interface Inflight {
  key: string;
  promise: Promise<PoolInfo[]>;
}

let inflight: Inflight | null = null;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function toNumber(value: bigint, decimals: number): number {
  return Number(value) / 10 ** decimals;
}

async function resolveFactory(chainId: number): Promise<string> {
  const factory = contractAddress(chainId, 'factory');
  if (factory) return factory;
  const router = contractAddress(chainId, 'router');
  if (router) {
    const fromRouter = await readAddress(chainId, router, FN.factory, 60_000);
    if (!isZeroAddress(fromRouter)) return fromRouter;
  }
  return '';
}

/** Metadados do token: registro primeiro, contrato depois. */
export async function loadTokenMeta(chainId: number, address: string): Promise<TokenMeta> {
  const known = findToken(chainId, address);
  if (known) {
    return { address: known.address, symbol: known.symbol, name: known.name, decimals: known.decimals };
  }
  try {
    const [symbol, decimalsHex] = await Promise.all([
      readString(chainId, address, FN.symbol, 60_000),
      ethCall(chainId, address, FN.decimals, 60_000),
    ]);
    const decimals = decimalsHex && decimalsHex !== '0x' ? Number(BigInt(decimalsHex)) : 18;
    return {
      address,
      symbol: symbol || '?',
      name: symbol || 'Token desconhecido',
      decimals: Number.isFinite(decimals) ? decimals : 18,
    };
  } catch {
    return { address, symbol: '?', name: 'Token desconhecido', decimals: 18 };
  }
}

// ─── AMM da Kurama ───────────────────────────────────────────────────

export async function loadKuramaPools(chainId: number, account?: string): Promise<PoolInfo[]> {
  const factory = await resolveFactory(chainId);
  if (!factory) throw new Error('KurFactory não configurado');

  const total = Number(await readUint(chainId, factory, FN.allPairsLength, 0, 15_000));
  const count = Math.min(total, KUR_POOL_CAP);
  if (count === 0) return [];

  const pairs: string[] = [];
  for (const batch of chunk(Array.from({ length: count }, (_, index) => index), 8)) {
    const addresses = await Promise.all(
      batch.map((index) =>
        readAddress(chainId, factory, FN.allPairs + index.toString(16).padStart(64, '0'), 15_000),
      ),
    );
    addresses.forEach((address) => {
      if (!isZeroAddress(address)) pairs.push(address);
    });
  }

  const pools: PoolInfo[] = [];
  for (const batch of chunk(pairs, 4)) {
    const loaded = await Promise.all(
      batch.map(async (pair): Promise<PoolInfo | null> => {
        try {
          const [token0, token1, reservesHex, lpSupply, myLp] = await Promise.all([
            readAddress(chainId, pair, FN.token0),
            readAddress(chainId, pair, FN.token1),
            ethCall(chainId, pair, FN.getReserves),
            readUint(chainId, pair, FN.totalSupply, 0, 10_000),
            account ? readUint(chainId, pair, encodeBalanceOf(account), 0, 5_000) : Promise.resolve(0n),
          ]);
          if (!reservesHex || reservesHex === '0x') return null;
          const reserve0 = BigInt('0x' + reservesHex.slice(2, 66));
          const reserve1 = BigInt('0x' + reservesHex.slice(66, 130));
          const [meta0, meta1] = await Promise.all([
            loadTokenMeta(chainId, token0),
            loadTokenMeta(chainId, token1),
          ]);
          const prices = await getPrices(chainId, [token0, token1]);
          const price0Usd = prices[token0.toLowerCase()]?.usd ?? null;
          const price1Usd = prices[token1.toLowerCase()]?.usd ?? null;
          const tvlUsd =
            price0Usd === null || price1Usd === null
              ? null
              : toNumber(reserve0, meta0.decimals) * price0Usd +
                toNumber(reserve1, meta1.decimals) * price1Usd;
          return {
            chainId,
            address: pair,
            dex: 'kur' as const,
            token0: meta0,
            token1: meta1,
            reserve0,
            reserve1,
            lpSupply,
            fee: 0.003,
            price0Usd,
            price1Usd,
            tvlUsd,
            myLp,
            myShare:
              myLp > 0n && lpSupply > 0n ? Number((myLp * 10_000n) / lpSupply) / 10_000 : 0,
          };
        } catch {
          return null;
        }
      }),
    );
    loaded.forEach((pool) => {
      if (pool) pools.push(pool);
    });
  }

  return pools.sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0));
}

// ─── Uniswap V3 (redes públicas) ─────────────────────────────────────

export async function loadUniswapPools(chainId: number, account?: string): Promise<PoolInfo[]> {
  const chain = getChain(chainId);
  if (!chain?.uniswapV3Factory) return [];

  const tokens = tokensForChain(chainId).filter((token) => !isNativeToken(token.address));
  const anchors = tokens
    .filter((token) => token.tags.includes('stable') || token.tags.includes('wrapped'))
    .slice(0, 3);
  if (!anchors.length) return [];

  const pairs: Array<{ a: string; b: string }> = [];
  const seen = new Set<string>();
  for (const anchor of anchors) {
    for (const token of tokens) {
      if (sameAddress(token.address, anchor.address)) continue;
      const key = [token.address, anchor.address]
        .map((address) => address.toLowerCase())
        .sort()
        .join(':');
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ a: token.address, b: anchor.address });
      if (pairs.length >= V3_POOL_CAP) break;
    }
    if (pairs.length >= V3_POOL_CAP) break;
  }

  const prices = await getPrices(
    chainId,
    Array.from(new Set(pairs.flatMap((pair) => [pair.a, pair.b]))),
  );

  const pools: PoolInfo[] = [];
  for (const batch of chunk(pairs, 3)) {
    const loaded = await Promise.all(
      batch.map(async ({ a, b }): Promise<PoolInfo | null> => {
        const found = await findV3Pool(chainId, a, b);
        if (!found) return null;
        const state = await readV3PoolPrice(chainId, found.pool);
        if (!state) return null;
        const [meta0, meta1, bal0Hex, bal1Hex, liquidity, myLp] = await Promise.all([
          loadTokenMeta(chainId, state.token0),
          loadTokenMeta(chainId, state.token1),
          ethCall(chainId, state.token0, encodeBalanceOf(found.pool)),
          ethCall(chainId, state.token1, encodeBalanceOf(found.pool)),
          readUint(chainId, found.pool, '0x1a686502', 0, 15_000).catch(() => 0n),
          account
            ? readUint(chainId, found.pool, encodeBalanceOf(account), 0, 10_000).catch(() => 0n)
            : Promise.resolve(0n),
        ]);
        const reserve0 = bal0Hex && bal0Hex !== '0x' ? BigInt(bal0Hex) : 0n;
        const reserve1 = bal1Hex && bal1Hex !== '0x' ? BigInt(bal1Hex) : 0n;
        const price0Usd = prices[state.token0.toLowerCase()]?.usd ?? null;
        const price1Usd = prices[state.token1.toLowerCase()]?.usd ?? null;
        const tvlUsd =
          price0Usd === null || price1Usd === null
            ? null
            : toNumber(reserve0, meta0.decimals) * price0Usd +
              toNumber(reserve1, meta1.decimals) * price1Usd;
        return {
          chainId,
          address: found.pool,
          dex: 'uniswap-v3' as const,
          token0: meta0,
          token1: meta1,
          reserve0,
          reserve1,
          lpSupply: liquidity,
          fee: found.fee / 1_000_000,
          price0Usd,
          price1Usd,
          tvlUsd,
          myLp,
          myShare: undefined,
        };
      }),
    );
    loaded.forEach((pool) => {
      if (pool) pools.push(pool);
    });
  }

  return pools.sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0));
}

/** Pools da rede (deduplica chamadas concorrentes da mesma tela). */
export async function loadPools(chainId: number, account?: string): Promise<PoolInfo[]> {
  const key = `${chainId}:${account ?? ''}`;
  if (inflight && inflight.key === key) return inflight.promise;
  const promise =
    chainId === KURAMA_CHAIN_ID ? loadKuramaPools(chainId, account) : loadUniswapPools(chainId, account);
  inflight = { key, promise };
  try {
    return await promise;
  } finally {
    if (inflight?.key === key) inflight = null;
  }
}

// ─── Trades / volume ────────────────────────────────────────────────

export function blocksForHours(chainId: number, hours: number): number {
  const seconds = getChain(chainId)?.blockTimeSeconds ?? 12;
  return Math.max(60, Math.round((hours * 3600) / seconds));
}

interface RawLog {
  data: string;
  topics: string[];
  blockNumber: string;
  transactionHash: string;
}

/** Eventos `Swap` do par, opcionalmente numa janela de blocos. */
export async function loadPairTrades(
  chainId: number,
  pool: PoolInfo,
  options: { hours?: number } = {},
): Promise<PairTrade[]> {
  const latest = await getBlockNumber(chainId);
  const window = blocksForHours(chainId, options.hours ?? 24);
  const fromBlock = Math.max(0, latest - window);

  let logs: RawLog[] = [];
  try {
    logs = await rpc<RawLog[]>(
      chainId,
      'eth_getLogs',
      [{ address: pool.address, topics: [EVT.PairSwap], fromBlock: `0x${fromBlock.toString(16)}`, toBlock: 'latest' }],
      { timeoutMs: 25_000 },
    );
  } catch {
    return [];
  }
  if (!Array.isArray(logs) || !logs.length) return [];
  const sliced = logs.length > TRADE_LOG_CAP ? logs.slice(-TRADE_LOG_CAP) : logs;

  return sliced
    .map((log): PairTrade | null => {
      try {
        const hex = log.data.startsWith('0x') ? log.data.slice(2) : log.data;
        const word = (index: number) => BigInt('0x' + hex.slice(index * 64, index * 64 + 64));
        const amount0In = word(0);
        const amount1In = word(1);
        const amount0Out = word(2);
        const amount1Out = word(3);
        const dec0 = pool.token0.decimals;
        const dec1 = pool.token1.decimals;
        let price: number | null = null;
        if (amount0In > 0n && amount1Out > 0n) {
          price = toNumber(amount1Out, dec1) / toNumber(amount0In, dec0);
        } else if (amount1In > 0n && amount0Out > 0n) {
          price = toNumber(amount1In, dec1) / toNumber(amount0Out, dec0);
        }
        const paidToken = amount0In > 0n ? pool.token0 : pool.token1;
        const paidAmount = amount0In > 0n ? amount0In : amount1In;
        const paidUsd = amount0In > 0n ? pool.price0Usd : pool.price1Usd;
        const volumeUsd = paidUsd === null ? null : toNumber(paidAmount, paidToken.decimals) * paidUsd;
        return {
          txHash: log.transactionHash,
          blockNumber: Number.parseInt(log.blockNumber, 16),
          timestamp: null,
          price: price !== null && Number.isFinite(price) ? price : null,
          amount0In,
          amount1In,
          amount0Out,
          amount1Out,
          volumeUsd,
        };
      } catch {
        return null;
      }
    })
    .filter((trade): trade is PairTrade => trade !== null)
    .sort((a, b) => a.blockNumber - b.blockNumber);
}

/** Volume e nº de trades numa janela (horas) para um pool. */
export async function loadPoolVolume(
  chainId: number,
  pool: PoolInfo,
  hours = 24,
): Promise<{ volumeUsd: number | null; trades: number; series: PairTrade[] }> {
  const trades = await loadPairTrades(chainId, pool, { hours });
  if (!trades.length) return { volumeUsd: 0, trades: 0, series: [] };
  const withUsd = trades.filter((trade) => trade.volumeUsd !== null);
  const volumeUsd = withUsd.length
    ? withUsd.reduce((sum, trade) => sum + (trade.volumeUsd ?? 0), 0)
    : null;
  return { volumeUsd, trades: trades.length, series: trades };
}

export function poolPrice(pool: PoolInfo, base: 'token0' | 'token1'): number | null {
  const reserve0 = toNumber(pool.reserve0, pool.token0.decimals);
  const reserve1 = toNumber(pool.reserve1, pool.token1.decimals);
  if (reserve0 <= 0 || reserve1 <= 0) return null;
  return base === 'token0' ? reserve1 / reserve0 : reserve0 / reserve1;
}
