import { loadBalancesFor } from '../services/portfolio';
import { useAsync } from './useAsync';

export interface TokenBalanceEntry {
  balance: bigint;
  priceUsd: number | null;
  decimals: number;
}

/** Saldos (wei) + preço dos tokens pedidos, para a conta conectada. */
export function useTokenBalances(
  chainId: number,
  account: string | null,
  addresses: string[],
  pollMs = 15_000,
) {
  const key = addresses.map((address) => address.toLowerCase()).sort().join(',');
  return useAsync(
    async () => loadBalancesFor(chainId, account as string, addresses),
    [chainId, account, key],
    { pollMs, enabled: !!account && addresses.length > 0 },
  );
}
