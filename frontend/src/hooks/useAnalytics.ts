import { useRef } from 'react';
import type { PoolInfo } from '../types/defi';
import { loadAnalytics } from '../services/analytics';
import { useAsync } from './useAsync';

const EMPTY_POOLS: PoolInfo[] = [];

/**
 * Analytics da rede, a partir dos pools já carregados.
 *
 * O polling de pools entrega um array novo a cada 20s mesmo quando os valores
 * não mudaram; depender da identidade do array refaria todos os `eth_getLogs`
 * do volume. A dependência é a assinatura dos valores lidos (reservas e preço).
 */
export function useAnalytics(
  chainId: number,
  pools: PoolInfo[],
  pollMs = 60_000,
) {
  const list = pools.length ? pools : EMPTY_POOLS;
  const poolsRef = useRef(list);
  poolsRef.current = list;

  const signature = list
    .map(
      (pool) =>
        `${pool.address}:${pool.reserve0}:${pool.reserve1}:${pool.price0Usd}:${pool.price1Usd}`,
    )
    .join('|');

  return useAsync(
    () => loadAnalytics(chainId, poolsRef.current, { maxPools: 6 }),
    [chainId, signature],
    { pollMs, enabled: list.length > 0 },
  );
}
