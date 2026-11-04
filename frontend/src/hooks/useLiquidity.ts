import { useCallback, useState } from 'react';
import type { PoolInfo } from '../types/defi';
import { addLiquidity, removeLiquidity, type LiquidityResult } from '../services/liquidity';
import { errorMessage } from './useAsync';

export function useLiquidity(chainId: number, account: string | null) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LiquidityResult | null>(null);

  const add = useCallback(
    async (pool: PoolInfo, amount0: bigint, amount1: bigint) => {
      if (!account) throw new Error('Conecte a carteira');
      setBusy(true);
      setError(null);
      setResult(null);
      try {
        const next = await addLiquidity(chainId, account, pool, amount0, amount1);
        setResult(next);
        return next;
      } catch (err) {
        setError(errorMessage(err));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [account, chainId],
  );

  const remove = useCallback(
    async (pool: PoolInfo, lpAmount: bigint) => {
      if (!account) throw new Error('Conecte a carteira');
      setBusy(true);
      setError(null);
      setResult(null);
      try {
        const next = await removeLiquidity(chainId, account, pool, lpAmount);
        setResult(next);
        return next;
      } catch (err) {
        setError(errorMessage(err));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [account, chainId],
  );

  return { add, remove, busy, error, result, clear: () => setResult(null) };
}
