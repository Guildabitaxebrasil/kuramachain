/**
 * Analytics da DeFi.
 *
 * - Volume/taxas: eventos `Swap` reais dos pools (`eth_getLogs`).
 * - TVL: reservas × preço no momento da leitura.
 * - Séries históricas (TVL, volume, preço): snapshots locais gravados a cada
 *   leitura (máx. 1 por minuto). Antes de existir histórico, a UI mostra
 *   “Histórico insuficiente” em vez de inventar uma curva.
 */
import type { PoolInfo, TimeSeriesPoint } from '../types/defi';
import { loadPoolVolume } from './pools';

const ANALYTICS_KEY = 'kurama.analytics.v1';
const PRICE_KEY = 'kurama.priceHistory.v1';
const MAX_POINTS = 1_440;

export interface AnalyticsSnapshot {
  t: number;
  tvlUsd: number | null;
  volume24hUsd: number | null;
  pools: number;
}

export interface PoolVolume {
  pool: PoolInfo;
  volume24hUsd: number | null;
  volume7dUsd: number | null;
  trades24h: number;
  truncated: boolean;
}

export interface AnalyticsSummary {
  tvlUsd: number | null;
  volume24hUsd: number | null;
  volume7dUsd: number | null;
  fees24hUsd: number | null;
  pools: number;
  trades24h: number;
  pricedPools: number;
  truncated: boolean;
  perPool: PoolVolume[];
  tvlHistory: TimeSeriesPoint[];
  volumeHistory: TimeSeriesPoint[];
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // sem storage: série só existe durante a sessão
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// ─── Snapshots de TVL/volume ─────────────────────────────────────────

export function recordAnalyticsSnapshot(chainId: number, snapshot: Omit<AnalyticsSnapshot, 't'>): void {
  const store = readJson<Record<string, AnalyticsSnapshot[]>>(ANALYTICS_KEY, {});
  const list = store[String(chainId)] ?? [];
  const now = nowSeconds();
  const last = list[list.length - 1];
  if (last && now - last.t < 60) {
    // Mantém o ponto mais recente atualizado dentro do minuto.
    list[list.length - 1] = { ...last, ...snapshot };
  } else {
    list.push({ t: now, ...snapshot });
  }
  store[String(chainId)] = list.slice(-MAX_POINTS);
  writeJson(ANALYTICS_KEY, store);
}

export function loadAnalyticsHistory(chainId: number): AnalyticsSnapshot[] {
  return readJson<Record<string, AnalyticsSnapshot[]>>(ANALYTICS_KEY, {})[String(chainId)] ?? [];
}

// ─── Histórico de preço por token ───────────────────────────────────

export function recordTokenPrice(chainId: number, address: string, usd: number | null): void {
  if (usd === null || !Number.isFinite(usd) || usd <= 0) return;
  const store = readJson<Record<string, Record<string, TimeSeriesPoint[]>>>(PRICE_KEY, {});
  const perChain = store[String(chainId)] ?? {};
  const key = address.toLowerCase();
  const list = perChain[key] ?? [];
  const now = nowSeconds();
  const last = list[list.length - 1];
  if (last && now - last.t < 60) return;
  list.push({ t: now, v: usd });
  perChain[key] = list.slice(-MAX_POINTS);
  store[String(chainId)] = perChain;
  writeJson(PRICE_KEY, store);
}

export function loadTokenPriceHistory(chainId: number, address: string): TimeSeriesPoint[] {
  return (
    readJson<Record<string, Record<string, TimeSeriesPoint[]>>>(PRICE_KEY, {})[String(chainId)]?.[
      address.toLowerCase()
    ] ?? []
  );
}

/** Variação percentual do preço numa janela (horas); `null` sem histórico. */
export function priceChangePct(
  chainId: number,
  address: string,
  hours: number,
): number | null {
  const history = loadTokenPriceHistory(chainId, address);
  if (history.length < 2) return null;
  const cutoff = nowSeconds() - hours * 3600;
  const past = [...history].reverse().find((point) => point.t <= cutoff) ?? history[0];
  const last = history[history.length - 1];
  if (!past || past.v <= 0) return null;
  return ((last.v - past.v) / past.v) * 100;
}

// ─── Resumo ─────────────────────────────────────────────────────────

export async function loadAnalytics(
  chainId: number,
  pools: PoolInfo[],
  options: { maxPools?: number; with7d?: boolean } = {},
): Promise<AnalyticsSummary> {
  const maxPools = options.maxPools ?? 8;
  const selected = pools.filter((pool) => pool.tvlUsd !== null).slice(0, maxPools);

  const perPool: PoolVolume[] = [];
  for (const pool of selected) {
    const day = await loadPoolVolume(chainId, pool, 24);
    let volume7dUsd: number | null = null;
    let truncated = false;
    if (options.with7d !== false) {
      const week = await loadPoolVolume(chainId, pool, 24 * 7);
      if (week.series.length >= 400) truncated = true;
      volume7dUsd = week.volumeUsd;
    }
    perPool.push({
      pool,
      volume24hUsd: day.volumeUsd,
      volume7dUsd,
      trades24h: day.trades,
      truncated: day.series.length >= 400,
    });
  }

  const tvlKnown = pools.filter((pool) => pool.tvlUsd !== null);
  const tvlUsd = tvlKnown.length ? tvlKnown.reduce((sum, pool) => sum + (pool.tvlUsd ?? 0), 0) : null;

  const dayVolumes = perPool.filter((item) => item.volume24hUsd !== null);
  const volume24hUsd = dayVolumes.length
    ? dayVolumes.reduce((sum, item) => sum + (item.volume24hUsd ?? 0), 0)
    : pools.length
      ? null
      : 0;

  const weekVolumes = perPool.filter((item) => item.volume7dUsd !== null);
  const volume7dUsd = weekVolumes.length
    ? weekVolumes.reduce((sum, item) => sum + (item.volume7dUsd ?? 0), 0)
    : null;

  const fees24hUsd = volume24hUsd === null ? null : volume24hUsd * 0.003;
  const trades24h = perPool.reduce((sum, item) => sum + item.trades24h, 0);

  recordAnalyticsSnapshot(chainId, {
    tvlUsd,
    volume24hUsd,
    pools: pools.length,
  });

  const history = loadAnalyticsHistory(chainId);
  return {
    tvlUsd,
    volume24hUsd,
    volume7dUsd,
    fees24hUsd,
    pools: pools.length,
    trades24h,
    pricedPools: tvlKnown.length,
    truncated: perPool.some((item) => item.truncated),
    perPool,
    tvlHistory: history
      .filter((point) => point.tvlUsd !== null)
      .map((point) => ({ t: point.t, v: point.tvlUsd as number })),
    volumeHistory: history
      .filter((point) => point.volume24hUsd !== null)
      .map((point) => ({ t: point.t, v: point.volume24hUsd as number })),
  };
}

/** Variação da TVL numa janela (horas) a partir dos snapshots. */
export function tvlChangePct(chainId: number, hours: number): number | null {
  const history = loadAnalyticsHistory(chainId).filter((point) => point.tvlUsd !== null);
  if (history.length < 2) return null;
  const cutoff = nowSeconds() - hours * 3600;
  const past = [...history].reverse().find((point) => point.t <= cutoff) ?? history[0];
  const last = history[history.length - 1];
  const base = past.tvlUsd ?? 0;
  const current = last.tvlUsd ?? 0;
  if (base <= 0) return null;
  return ((current - base) / base) * 100;
}

export function volumeChangePct(chainId: number, hours: number): number | null {
  const history = loadAnalyticsHistory(chainId).filter((point) => point.volume24hUsd !== null);
  if (history.length < 2) return null;
  const cutoff = nowSeconds() - hours * 3600;
  const past = [...history].reverse().find((point) => point.t <= cutoff) ?? history[0];
  const last = history[history.length - 1];
  const base = past.volume24hUsd ?? 0;
  const current = last.volume24hUsd ?? 0;
  if (base <= 0) return null;
  return ((current - base) / base) * 100;
}
