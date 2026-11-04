import { loadPools } from '../services/pools';
import { useAsync } from './useAsync';

/**
 * Pools da rede ativa.
 *
 * Na KuramaChain são os pares do `KurFactory`; nas redes externas, os pools
 * Uniswap V3 descobertos para os tokens conhecidos. Polling de 20s (o nó local
 * sela um bloco por transação, então não adianta consultar mais rápido).
 */
export function usePools(chainId: number, account: string | null, pollMs = 20_000) {
  return useAsync(
    () => loadPools(chainId, account ?? undefined),
    [chainId, account],
    { pollMs },
  );
}
