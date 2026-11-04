/**
 * Kurama Intelligence — leitura analítica dos dados que já existem.
 *
 * Nada aqui é estimativa inventada: as oportunidades triangulares usam os
 * preços médios das reservas do AMM, as variações vêm do histórico local de
 * preço/TVL e o risco usa liquidez real. Sem dado suficiente, o campo fica
 * `null` e a UI diz “Histórico insuficiente”.
 */
import type { IntelligenceInsight, PoolInfo } from '../types/defi';
import { priceChangePct, recordTokenPrice, tvlChangePct, type AnalyticsSummary } from './analytics';
import { poolPrice } from './pools';

export interface TriangleOpportunity {
  tokens: [string, string, string];
  directRate: number;
  indirectRate: number;
  gapPct: number;
}

export interface TokenMove {
  address: string;
  symbol: string;
  priceUsd: number | null;
  change1h: number | null;
  change24h: number | null;
  change7d: number | null;
}

export interface IntelligenceReport {
  topLiquidity: PoolInfo[];
  topVolume: Array<{ pool: PoolInfo; volumeUsd: number | null }>;
  tvlChange24h: number | null;
  tokenMoves: TokenMove[];
  triangles: TriangleOpportunity[];
  risks: IntelligenceInsight[];
  insights: IntelligenceInsight[];
}

function symbolOf(pools: PoolInfo[], address: string): string {
  for (const pool of pools) {
    if (pool.token0.address.toLowerCase() === address.toLowerCase()) return pool.token0.symbol;
    if (pool.token1.address.toLowerCase() === address.toLowerCase()) return pool.token1.symbol;
  }
  return address.slice(0, 6);
}

function rateBetween(pools: PoolInfo[], from: string, to: string): number | null {
  for (const pool of pools) {
    const isFrom0 = pool.token0.address.toLowerCase() === from.toLowerCase();
    const isFrom1 = pool.token1.address.toLowerCase() === from.toLowerCase();
    if (!isFrom0 && !isFrom1) continue;
    const other = isFrom0 ? pool.token1.address : pool.token0.address;
    if (other.toLowerCase() !== to.toLowerCase()) continue;
    return poolPrice(pool, isFrom0 ? 'token0' : 'token1');
  }
  return null;
}

export function findTriangleGaps(pools: PoolInfo[], minGapPct = 0.5): TriangleOpportunity[] {
  const addresses = Array.from(
    new Set(pools.flatMap((pool) => [pool.token0.address.toLowerCase(), pool.token1.address.toLowerCase()])),
  );
  if (addresses.length < 3) return [];

  const neighbours = new Map<string, Set<string>>();
  for (const pool of pools) {
    const a = pool.token0.address.toLowerCase();
    const b = pool.token1.address.toLowerCase();
    if (!neighbours.has(a)) neighbours.set(a, new Set());
    if (!neighbours.has(b)) neighbours.set(b, new Set());
    neighbours.get(a)?.add(b);
    neighbours.get(b)?.add(a);
  }

  const found: TriangleOpportunity[] = [];
  const seen = new Set<string>();
  for (const a of addresses) {
    for (const b of neighbours.get(a) ?? []) {
      if (b <= a) continue;
      for (const c of neighbours.get(a) ?? []) {
        if (c <= b) continue;
        if (!neighbours.get(b)?.has(c)) continue;
        const key = [a, b, c].sort().join(':');
        if (seen.has(key)) continue;
        seen.add(key);
        const directAB = rateBetween(pools, a, b);
        const directBC = rateBetween(pools, b, c);
        const directAC = rateBetween(pools, a, c);
        if (directAB === null || directBC === null || directAC === null || directAC <= 0) continue;
        const indirect = directAB * directBC;
        const gapPct = (indirect / directAC - 1) * 100;
        if (Number.isFinite(gapPct) && Math.abs(gapPct) >= minGapPct) {
          found.push({
            tokens: [symbolOf(pools, a), symbolOf(pools, b), symbolOf(pools, c)],
            directRate: directAC,
            indirectRate: indirect,
            gapPct,
          });
        }
      }
    }
  }
  return found.sort((left, right) => Math.abs(right.gapPct) - Math.abs(left.gapPct));
}

export function buildIntelligence(
  pools: PoolInfo[],
  analytics: AnalyticsSummary | null,
): IntelligenceReport {
  const priced = pools.filter((pool) => pool.tvlUsd !== null);
  const topLiquidity = [...priced].sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0)).slice(0, 5);

  const topVolume = (analytics?.perPool ?? [])
    .slice()
    .sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0))
    .slice(0, 5)
    .map((item) => ({ pool: item.pool, volumeUsd: item.volume24hUsd }));

  const tokens = new Map<string, { symbol: string; price: number | null }>();
  for (const pool of pools) {
    const entries: Array<[string, string, number | null]> = [
      [pool.token0.address, pool.token0.symbol, pool.price0Usd],
      [pool.token1.address, pool.token1.symbol, pool.price1Usd],
    ];
    for (const [address, symbol, price] of entries) {
      if (!tokens.has(address.toLowerCase())) {
        tokens.set(address.toLowerCase(), { symbol, price });
        if (price !== null && pool.chainId) recordTokenPrice(pool.chainId, address, price);
      }
    }
  }

  const chainId = pools[0]?.chainId ?? 0;
  const tokenMoves: TokenMove[] = Array.from(tokens.entries()).map(([address, info]) => ({
    address,
    symbol: info.symbol,
    priceUsd: info.price,
    change1h: chainId ? priceChangePct(chainId, address, 1) : null,
    change24h: chainId ? priceChangePct(chainId, address, 24) : null,
    change7d: chainId ? priceChangePct(chainId, address, 24 * 7) : null,
  }));

  const triangles = findTriangleGaps(pools);
  const change = chainId ? tvlChangePct(chainId, 24) : null;

  const insights: IntelligenceInsight[] = [];
  const risks: IntelligenceInsight[] = [];

  if (topLiquidity[0]) {
    const pool = topLiquidity[0];
    insights.push({
      id: 'top-liquidity',
      title: `Maior liquidez: ${pool.token0.symbol}/${pool.token1.symbol}`,
      detail: `TVL de ${pool.tvlUsd?.toLocaleString('pt-BR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} no pool ${pool.address.slice(0, 10)}…`,
      tone: 'positive',
    });
  }

  if (topVolume[0]?.volumeUsd) {
    insights.push({
      id: 'top-volume',
      title: `Maior volume 24h: ${topVolume[0].pool.token0.symbol}/${topVolume[0].pool.token1.symbol}`,
      detail: `${topVolume[0].volumeUsd.toLocaleString('pt-BR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} em 24h (eventos Swap on-chain).`,
      tone: 'positive',
    });
  }

  if (change !== null) {
    insights.push({
      id: 'tvl-change',
      title: `TVL ${change >= 0 ? 'subiu' : 'caiu'} ${Math.abs(change).toFixed(2)}% em 24h`,
      detail: 'Comparação entre snapshots de TVL gravados por esta interface.',
      tone: change >= 0 ? 'positive' : 'negative',
    });
  }

  if (triangles[0]) {
    const best = triangles[0];
    insights.push({
      id: 'triangle',
      title: `Assimetria ${best.tokens.join(' → ')}: ${best.gapPct.toFixed(2)}%`,
      detail: `Rota indireta paga ${(best.indirectRate / best.directRate).toFixed(4)}× o preço direto. Diferença bruta — custos de gas, taxa de 0,3% por salto e slippage não estão incluídos.`,
      tone: Math.abs(best.gapPct) > 1.5 ? 'warning' : 'neutral',
    });
  }

  const mover = tokenMoves
    .filter((move) => move.change24h !== null)
    .sort((a, b) => Math.abs(b.change24h ?? 0) - Math.abs(a.change24h ?? 0))[0];
  if (mover && mover.change24h !== null) {
    insights.push({
      id: 'mover',
      title: `${mover.symbol} ${mover.change24h >= 0 ? 'em alta' : 'em queda'} (${mover.change24h.toFixed(2)}% em 24h)`,
      detail: 'Variação calculada com o histórico de preço observado nesta interface.',
      tone: mover.change24h >= 0 ? 'positive' : 'negative',
    });
  }

  for (const pool of pools) {
    if (pool.tvlUsd !== null && pool.tvlUsd < 100) {
      risks.push({
        id: `risk-low-${pool.address}`,
        title: `Liquidez baixa em ${pool.token0.symbol}/${pool.token1.symbol}`,
        detail: `TVL de ${pool.tvlUsd.toFixed(2)} USD — slippage alto para qualquer trade relevante.`,
        tone: 'warning',
      });
    }
    if (pool.tvlUsd === null) {
      risks.push({
        id: `risk-noprice-${pool.address}`,
        title: `Sem preço on-chain para ${pool.token0.symbol}/${pool.token1.symbol}`,
        detail: 'TVL e volume em USD ficam indisponíveis até existir uma fonte de preço para os dois tokens.',
        tone: 'neutral',
      });
    }
    const reserve0 = Number(pool.reserve0);
    const reserve1 = Number(pool.reserve1);
    if (reserve0 === 0 || reserve1 === 0) {
      risks.push({
        id: `risk-empty-${pool.address}`,
        title: `Pool vazio ${pool.token0.symbol}/${pool.token1.symbol}`,
        detail: 'O par existe no factory, mas não tem reservas — swaps vão reverter.',
        tone: 'warning',
      });
    }
  }

  return {
    topLiquidity,
    topVolume,
    tvlChange24h: change,
    tokenMoves,
    triangles,
    risks,
    insights,
  };
}
