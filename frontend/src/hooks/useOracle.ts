import { loadOracleOverview } from '../services/oracle';
import { useAsync } from './useAsync';

export function useOracle(chainId: number, pollMs = 30_000) {
  return useAsync(() => loadOracleOverview(chainId), [chainId], { pollMs });
}
