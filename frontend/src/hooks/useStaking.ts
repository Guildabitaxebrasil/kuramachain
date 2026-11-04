import { useCallback, useState } from 'react';
import type { StakingPool } from '../types/defi';
import {
  claimRewards,
  emergencyUnstake,
  loadStakingPools,
  stakeTokens,
  unstakeTokens,
  type StakingActionResult,
} from '../services/staking';
import { useAsync, errorMessage } from './useAsync';

export function useStaking(chainId: number, account: string | null, pollMs = 30_000) {
  const state = useAsync(
    () => loadStakingPools(chainId, account),
    [chainId, account],
    { pollMs },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (fn: () => Promise<StakingActionResult>): Promise<StakingActionResult | null> => {
      setBusy(true);
      setError(null);
      try {
        const result = await fn();
        state.refresh();
        return result;
      } catch (err) {
        setError(errorMessage(err));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [state],
  );

  const stake = useCallback(
    (pool: StakingPool, amount: bigint) => {
      if (!account) throw new Error('Conecte a carteira');
      return run(() => stakeTokens(chainId, account, pool, amount));
    },
    [account, chainId, run],
  );

  const unstake = useCallback(
    (pool: StakingPool, amount: bigint) => {
      if (!account) throw new Error('Conecte a carteira');
      return run(() => unstakeTokens(chainId, account, pool, amount));
    },
    [account, chainId, run],
  );

  const claim = useCallback(
    (pool: StakingPool) => {
      if (!account) throw new Error('Conecte a carteira');
      return run(() => claimRewards(chainId, account, pool));
    },
    [account, chainId, run],
  );

  const emergency = useCallback(
    (pool: StakingPool) => {
      if (!account) throw new Error('Conecte a carteira');
      return run(() => emergencyUnstake(chainId, account, pool));
    },
    [account, chainId, run],
  );

  return { ...state, busy, error, stake, unstake, claim, emergency };
}
