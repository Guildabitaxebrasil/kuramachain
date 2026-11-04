import { isAddress } from '../abi/coders';
import { getTokenUsd } from '../services/prices';
import { useAsync } from './useAsync';

/** Preço em USD + fonte (nunca um valor inventado: `usd: null` sem fonte). */
export function useTokenPrice(chainId: number, address: string | undefined, pollMs = 45_000) {
  return useAsync(
    async () => getTokenUsd(chainId, address as string),
    [chainId, address],
    { pollMs, enabled: !!address && isAddress(address) },
  );
}
