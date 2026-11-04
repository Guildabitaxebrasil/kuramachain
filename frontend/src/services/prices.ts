/**
 * Descoberta de preço em USD, on-chain.
 *
 * Fontes reais (nesta ordem):
 *  1. stablecoin (paridade 1:1 declarada) — `paridade USD`;
 *  2. KuramaChain: `KurPriceFeed.latestRoundData()` (KUR/USD), com fallback para
 *     o par do AMM contra um ativo já precificado;
 *  3. redes públicas: pool Uniswap V3 (`slot0.sqrtPriceX96`) contra USDC/USDT/DAI
 *     ou contra o wrapped nativo.
 *
 * Sem nenhuma dessas fontes o preço é `null` — a UI mostra “—”, nunca um número
 * inventado.
 */
import type { PriceResult } from '../types/defi';
import { FN, UNIV3 } from '../abi/selectors';
import { encodeAddress, encodeGetPair, isZeroAddress, sameAddress } from '../abi/coders';
import { ethCall, readAddress, readInt, readUint } from './rpc';
import { contractAddress } from '../contracts/registry';
import { findToken, tokensForChain, isNativeToken } from '../tokens/registry';
import { getChain, KURAMA_CHAIN_ID } from '../chains/chains';

const PRICE_TTL = 30_000;
const FEE_TIERS = [500, 3_000, 10_000, 100];

const cache = new Map<string, { expires: number; value: PriceResult }>();

const UNAVAILABLE = 'sem fonte de preço on-chain';

function toNumber(value: bigint, decimals: number): number {
  return Number(value) / 10 ** decimals;
}

function feeLabel(fee: number): string {
  return `${(fee / 10_000).toFixed(2).replace('.', ',')}%`;
}

function cachedPrice(chainId: number, address: string): PriceResult | null {
  const entry = cache.get(`${chainId}:${address.toLowerCase()}`);
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    cache.delete(`${chainId}:${address.toLowerCase()}`);
    return null;
  }
  return entry.value;
}

export function clearPriceCache(): void {
  cache.clear();
}

// ─── Uniswap V3 (redes públicas) ─────────────────────────────────────

interface V3PoolPrice {
  pool: string;
  fee: number;
  /** Quantas unidades de `tokenB` valem 1 unidade de `tokenA`. */
  rate: number;
}

function uniswapFactory(chainId: number): string {
  return contractAddress(chainId, 'uniswapFactory') || getChain(chainId)?.uniswapV3Factory || '';
}

export async function findV3Pool(chainId: number, tokenA: string, tokenB: string): Promise<{ pool: string; fee: number } | null> {
  const factory = uniswapFactory(chainId);
  if (!factory) return null;
  const [a, b] = [tokenA, tokenB].sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase()));
  for (const fee of FEE_TIERS) {
    try {
      const data = UNIV3.getPool + encodeAddress(a) + encodeAddress(b) + fee.toString(16).padStart(64, '0');
      const pool = await readAddress(chainId, factory, data, 30_000);
      if (!isZeroAddress(pool)) return { pool, fee };
    } catch {
      // RPC do contrato falhou nesse tier: tenta o próximo.
    }
  }
  return null;
}

/** Preço `token1` por `token0` no pool V3 (a partir de `sqrtPriceX96`). */
export async function readV3PoolPrice(
  chainId: number,
  pool: string,
): Promise<{ token0: string; token1: string; dec0: number; dec1: number; price0In1: number } | null> {
  try {
    const [token0, token1, slot0] = await Promise.all([
      readAddress(chainId, pool, FN.token0),
      readAddress(chainId, pool, FN.token1),
      ethCall(chainId, pool, UNIV3.slot0),
    ]);
    const dec0 = Number(await readUint(chainId, token0, FN.decimals, 0, 60_000));
    const dec1 = Number(await readUint(chainId, token1, FN.decimals, 0, 60_000));
    const sqrtPriceX96 = BigInt('0x' + slot0.slice(2, 66));
    const ratio = Number(sqrtPriceX96) / 2 ** 96;
    const price0In1 = ratio * ratio * 10 ** (dec0 - dec1);
    if (!Number.isFinite(price0In1) || price0In1 <= 0) return null;
    return { token0, token1, dec0, dec1, price0In1 };
  } catch {
    return null;
  }
}

async function v3Rate(chainId: number, tokenA: string, tokenB: string): Promise<V3PoolPrice | null> {
  const found = await findV3Pool(chainId, tokenA, tokenB);
  if (!found) return null;
  const state = await readV3PoolPrice(chainId, found.pool);
  if (!state) return null;
  const aIsToken0 = sameAddress(state.token0, tokenA);
  const rate = aIsToken0 ? state.price0In1 : 1 / state.price0In1;
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return { pool: found.pool, fee: found.fee, rate };
}

// ─── AMM da Kurama ───────────────────────────────────────────────────

async function kuramaPairRate(
  chainId: number,
  tokenA: string,
  tokenB: string,
): Promise<number | null> {
  const factory = contractAddress(chainId, 'factory');
  if (!factory) return null;
  try {
    const pair = await readAddress(chainId, factory, encodeGetPair(tokenA, tokenB));
    if (isZeroAddress(pair)) return null;
    const [token0, reservesHex] = await Promise.all([
      readAddress(chainId, pair, FN.token0),
      ethCall(chainId, pair, FN.getReserves),
    ]);
    const reserve0 = BigInt('0x' + reservesHex.slice(2, 66));
    const reserve1 = BigInt('0x' + reservesHex.slice(66, 130));
    const decA = findToken(chainId, tokenA)?.decimals ?? 18;
    const decB = findToken(chainId, tokenB)?.decimals ?? 18;
    const aIsToken0 = sameAddress(token0, tokenA);
    const reserveA = aIsToken0 ? reserve0 : reserve1;
    const reserveB = aIsToken0 ? reserve1 : reserve0;
    if (reserveA === 0n || reserveB === 0n) return null;
    const rate = toNumber(reserveB, decB) / toNumber(reserveA, decA);
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  } catch {
    return null;
  }
}

async function kuramaFeedPrice(chainId: number): Promise<PriceResult> {
  const feed = contractAddress(chainId, 'priceFeed');
  if (!feed) {
    return { usd: null, source: 'KurPriceFeed não configurado', updatedAt: null };
  }
  try {
    const answer = await readInt(chainId, feed, FN.latestRoundData, 1, 20_000);
    const updatedAt = await readUint(chainId, feed, FN.latestRoundData, 3, 20_000);
    const usd = toNumber(answer, 8);
    if (!Number.isFinite(usd) || usd <= 0) {
      return { usd: null, source: 'KurPriceFeed sem preço válido', updatedAt: Number(updatedAt) };
    }
    return { usd, source: 'KurPriceFeed (KUR/USD)', updatedAt: Number(updatedAt) };
  } catch {
    return { usd: null, source: 'KurPriceFeed indisponível', updatedAt: null };
  }
}

function isStable(chainId: number, address: string): boolean {
  return !!findToken(chainId, address)?.tags.includes('stable');
}

/** Tokens que servem de âncora de preço na rede. */
function anchorsFor(chainId: number): string[] {
  const chain = getChain(chainId);
  const anchors = tokensForChain(chainId)
    .filter((item) => item.tags.includes('stable'))
    .map((item) => item.address);
  if (chainId === KURAMA_CHAIN_ID) {
    const kur = contractAddress(chainId, 'token');
    if (kur) anchors.push(kur);
    const wkur = contractAddress(chainId, 'wrappedNative');
    if (wkur) anchors.push(wkur);
  } else if (chain?.wrappedNative) {
    anchors.push(chain.wrappedNative);
  }
  return anchors;
}

async function resolvePrice(
  chainId: number,
  address: string,
  depth: number,
  seen: Set<string>,
): Promise<PriceResult> {
  const key = `${chainId}:${address.toLowerCase()}`;
  if (seen.has(key) || depth > 3) return { usd: null, source: UNAVAILABLE, updatedAt: null };
  seen.add(key);

  const chain = getChain(chainId);
  if (isStable(chainId, address)) {
    return { usd: 1, source: 'paridade USD (stablecoin)', updatedAt: null };
  }

  if (isNativeToken(address)) {
    if (chainId === KURAMA_CHAIN_ID) return kuramaFeedPrice(chainId);
    if (chain?.wrappedNative) {
      const wrapped = await resolvePrice(chainId, chain.wrappedNative, depth + 1, seen);
      return wrapped.usd === null
        ? wrapped
        : { usd: wrapped.usd, source: `nativo ← ${wrapped.source}`, updatedAt: wrapped.updatedAt };
    }
    return { usd: null, source: UNAVAILABLE, updatedAt: null };
  }

  if (chainId === KURAMA_CHAIN_ID) {
    // O contrato KurToken é o KUR ERC-20 da chain: o feed KUR/USD se aplica.
    const kur = contractAddress(chainId, 'token');
    if (kur && sameAddress(kur, address)) return kuramaFeedPrice(chainId);
    const wkur = contractAddress(chainId, 'wrappedNative');
    if (wkur && sameAddress(wkur, address)) return kuramaFeedPrice(chainId);

    for (const anchor of anchorsFor(chainId)) {
      if (sameAddress(anchor, address)) continue;
      const rate = await kuramaPairRate(chainId, address, anchor);
      if (rate === null) continue;
      const anchorPrice = await resolvePrice(chainId, anchor, depth + 1, seen);
      if (anchorPrice.usd === null) continue;
      return {
        usd: rate * anchorPrice.usd,
        source: `par KurFactory × ${anchorPrice.source}`,
        updatedAt: null,
      };
    }
    return { usd: null, source: 'sem par com ativo precificado', updatedAt: null };
  }

  for (const anchor of anchorsFor(chainId)) {
    if (sameAddress(anchor, address)) continue;
    const found = await v3Rate(chainId, address, anchor);
    if (!found) continue;
    if (isStable(chainId, anchor)) {
      return { usd: found.rate, source: `Uniswap V3 ${feeLabel(found.fee)}`, updatedAt: null };
    }
    const anchorPrice = await resolvePrice(chainId, anchor, depth + 1, seen);
    if (anchorPrice.usd === null) continue;
    return {
      usd: found.rate * anchorPrice.usd,
      source: `Uniswap V3 ${feeLabel(found.fee)} × ${anchorPrice.source}`,
      updatedAt: null,
    };
  }

  // Caminho mais longo: via wrapped nativo (ex.: token/WETH → WETH/USDC).
  if (chain?.wrappedNative && !sameAddress(chain.wrappedNative, address)) {
    const viaWrapped = await v3Rate(chainId, address, chain.wrappedNative);
    if (viaWrapped) {
      const wrappedPrice = await resolvePrice(chainId, chain.wrappedNative, depth + 1, seen);
      if (wrappedPrice.usd !== null) {
        return {
          usd: viaWrapped.rate * wrappedPrice.usd,
          source: `Uniswap V3 ${feeLabel(viaWrapped.fee)} → wrapped`,
          updatedAt: null,
        };
      }
    }
  }

  return { usd: null, source: UNAVAILABLE, updatedAt: null };
}

/** Preço em USD de um token (ou `null` quando não há fonte on-chain). */
export async function getTokenUsd(chainId: number, address: string): Promise<PriceResult> {
  const hit = cachedPrice(chainId, address);
  if (hit) return hit;
  let value: PriceResult;
  try {
    value = await resolvePrice(chainId, address, 0, new Set());
  } catch (err) {
    value = {
      usd: null,
      source: err instanceof Error ? err.message : 'falha ao consultar preço',
      updatedAt: null,
    };
  }
  cache.set(`${chainId}:${address.toLowerCase()}`, { expires: Date.now() + PRICE_TTL, value });
  return value;
}

/** Preços de vários tokens em paralelo (sem estourar o RPC). */
export async function getPrices(
  chainId: number,
  addresses: string[],
): Promise<Record<string, PriceResult>> {
  const unique = Array.from(new Set(addresses.map((address) => address.toLowerCase())));
  const out: Record<string, PriceResult> = {};
  const chunk = 4;
  for (let i = 0; i < unique.length; i += chunk) {
    const slice = unique.slice(i, i + chunk);
    const results = await Promise.all(slice.map((address) => getTokenUsd(chainId, address)));
    slice.forEach((address, index) => {
      out[address] = results[index];
    });
  }
  return out;
}

export { toNumber, feeLabel };
