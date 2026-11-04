/**
 * Portfólio do usuário na rede selecionada.
 *
 * Saldos vêm do nó (`eth_getBalance` + `balanceOf`), os preços do serviço de
 * preços on-chain, e as posições de LP do `KurPair.balanceOf`. O histórico de
 * valor é local: começa a existir a partir da primeira leitura naquele
 * navegador (não há indexador de portfólio no nó).
 */
import type { PoolInfo, PortfolioSnapshot, TokenConfig } from '../types/defi';
import { encodeBalanceOf } from '../abi/coders';
import { getNativeBalance, readUint } from './rpc';
import { getPrices } from './prices';
import { isNativeToken, tokensForChain } from '../tokens/registry';
import { loadPools } from './pools';
import { recordTokenPrice } from './analytics';

export interface TokenHolding {
  token: TokenConfig;
  balance: bigint;
  priceUsd: number | null;
  valueUsd: number | null;
  priceSource: string;
}

export interface LpPosition {
  pool: PoolInfo;
  lp: bigint;
  share: number;
  amount0: bigint;
  amount1: bigint;
  valueUsd: number | null;
}

export interface PortfolioData {
  holdings: TokenHolding[];
  lps: LpPosition[];
  totalUsd: number | null;
  /** Tokens com saldo mas sem preço on-chain. */
  unpricedTokens: number;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function toNumber(value: bigint, decimals: number): number {
  return Number(value) / 10 ** decimals;
}

export async function loadHoldings(
  chainId: number,
  account: string,
): Promise<TokenHolding[]> {
  const tokens = tokensForChain(chainId);
  const balances = new Map<string, bigint>();

  const native = tokens.filter((token) => isNativeToken(token.address));
  for (const token of native) {
    balances.set(token.address.toLowerCase(), await getNativeBalance(chainId, account));
  }

  const erc20 = tokens.filter((token) => !isNativeToken(token.address));
  for (const batch of chunk(erc20, 4)) {
    const results = await Promise.all(
      batch.map(async (token) => {
        try {
          return await readUint(chainId, token.address, encodeBalanceOf(account), 0, 5_000);
        } catch {
          return 0n;
        }
      }),
    );
    batch.forEach((token, index) => balances.set(token.address.toLowerCase(), results[index]));
  }

  const prices = await getPrices(chainId, tokens.map((token) => token.address));

  return tokens
    .map((token): TokenHolding => {
      const balance = balances.get(token.address.toLowerCase()) ?? 0n;
      const price = prices[token.address.toLowerCase()];
      const priceUsd = price?.usd ?? null;
      // Alimenta o histórico local (variação 1h/24h/7d em Markets/Intelligence).
      if (priceUsd !== null) recordTokenPrice(chainId, token.address, priceUsd);
      return {
        token,
        balance,
        priceUsd,
        valueUsd: priceUsd === null ? null : toNumber(balance, token.decimals) * priceUsd,
        priceSource: price?.source ?? '—',
      };
    })
    .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0) || (b.balance > a.balance ? 1 : -1));
}

/** Saldos + preço de um conjunto específico de tokens (swap/liquidez). */
export async function loadBalancesFor(
  chainId: number,
  account: string,
  addresses: string[],
): Promise<Record<string, { balance: bigint; priceUsd: number | null; decimals: number }>> {
  const tokens = tokensForChain(chainId);
  const out: Record<string, { balance: bigint; priceUsd: number | null; decimals: number }> = {};
  const prices = await getPrices(chainId, addresses);
  for (const address of addresses) {
    const meta = tokens.find((token) => token.address.toLowerCase() === address.toLowerCase());
    try {
      const balance = isNativeToken(address)
        ? await getNativeBalance(chainId, account)
        : await readUint(chainId, address, encodeBalanceOf(account), 0, 4_000);
      out[address.toLowerCase()] = {
        balance,
        priceUsd: prices[address.toLowerCase()]?.usd ?? null,
        decimals: meta?.decimals ?? 18,
      };
    } catch {
      out[address.toLowerCase()] = { balance: 0n, priceUsd: prices[address.toLowerCase()]?.usd ?? null, decimals: meta?.decimals ?? 18 };
    }
  }
  return out;
}

export async function loadLpPositions(
  chainId: number,
  account: string,
  pools?: PoolInfo[],
): Promise<LpPosition[]> {
  const all = pools ?? (await loadPools(chainId, account));
  return all
    .filter((pool) => pool.dex === 'kur' && (pool.myLp ?? 0n) > 0n && pool.lpSupply > 0n)
    .map((pool): LpPosition => {
      const lp = pool.myLp ?? 0n;
      const amount0 = (pool.reserve0 * lp) / pool.lpSupply;
      const amount1 = (pool.reserve1 * lp) / pool.lpSupply;
      const value0 =
        pool.price0Usd === null ? null : toNumber(amount0, pool.token0.decimals) * pool.price0Usd;
      const value1 =
        pool.price1Usd === null ? null : toNumber(amount1, pool.token1.decimals) * pool.price1Usd;
      return {
        pool,
        lp,
        share: Number((lp * 10_000n) / pool.lpSupply) / 10_000,
        amount0,
        amount1,
        valueUsd: value0 === null || value1 === null ? null : value0 + value1,
      };
    });
}

export async function loadPortfolio(chainId: number, account: string): Promise<PortfolioData> {
  const [holdings, lps] = await Promise.all([
    loadHoldings(chainId, account),
    loadLpPositions(chainId, account),
  ]);
  const withBalance = holdings.filter((item) => item.balance > 0n);
  const unpriced = withBalance.filter((item) => item.priceUsd === null).length;
  const tokenTotal = withBalance.reduce((sum, item) => sum + (item.valueUsd ?? 0), 0);
  const lpTotal = lps.reduce((sum, item) => sum + (item.valueUsd ?? 0), 0);
  const anyPriced = withBalance.some((item) => item.valueUsd !== null) || lps.some((item) => item.valueUsd !== null);
  return {
    holdings,
    lps,
    totalUsd: anyPriced ? tokenTotal + lpTotal : null,
    unpricedTokens: unpriced,
  };
}

// ─── Histórico local do portfólio ────────────────────────────────────

const STORAGE_KEY = 'kurama.portfolio.v1';
const MAX_POINTS = 1_440;

function historyKey(chainId: number, account: string): string {
  return `${chainId}:${account.toLowerCase()}`;
}

function readHistory(): Record<string, PortfolioSnapshot[]> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, PortfolioSnapshot[]>) : {};
  } catch {
    return {};
  }
}

/** Registra o valor atual (no máximo 1 ponto por minuto). */
export function recordPortfolioSnapshot(
  chainId: number,
  account: string,
  valueUsd: number | null,
): void {
  if (valueUsd === null || !Number.isFinite(valueUsd)) return;
  const store = readHistory();
  const key = historyKey(chainId, account);
  const list = store[key] ?? [];
  const now = Math.floor(Date.now() / 1000);
  const last = list[list.length - 1];
  if (last && now - last.t < 60) return;
  list.push({ t: now, valueUsd });
  store[key] = list.slice(-MAX_POINTS);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // sem persistência: o gráfico fica vazio até a próxima sessão
  }
}

export function loadPortfolioHistory(
  chainId: number,
  account: string,
): PortfolioSnapshot[] {
  return readHistory()[historyKey(chainId, account)] ?? [];
}

/** Variação percentual do portfólio numa janela (horas). */
export function portfolioChange(
  history: PortfolioSnapshot[],
  hours: number,
): number | null {
  if (history.length < 2) return null;
  const cutoff = Math.floor(Date.now() / 1000) - hours * 3600;
  const past = [...history].reverse().find((point) => point.t <= cutoff);
  const base = past ?? history[0];
  const last = history[history.length - 1];
  if (!base || base.valueUsd <= 0) return null;
  return ((last.valueUsd - base.valueUsd) / base.valueUsd) * 100;
}
