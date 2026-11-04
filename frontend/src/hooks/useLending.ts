import { useCallback, useState } from 'react';
import { lendingAction, loadLending, type LendingResult } from '../services/lending';
import { useAsync, errorMessage } from './useAsync';

export type LendingActionKind = 'supply' | 'withdraw' | 'borrow' | 'repay';

export function useLending(chainId: number, account: string | null, pollMs = 30_000) {
  const state = useAsync(
    () => loadLending(chainId, account),
    [chainId, account],
    { pollMs },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = useCallback(
    async (
      action: LendingActionKind,
      asset: string,
      amount: bigint,
    ): Promise<LendingResult | null> => {
      if (!account) {
        setError('Conecte a carteira');
        return null;
      }
      setBusy(true);
      setError(null);
      try {
        const result = await lendingAction(chainId, account, action, asset, amount);
        state.refresh();
        return result;
      } catch (err) {
        setError(errorMessage(err));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [account, chainId, state],
  );

  return { ...state, busy, error, act, clearError: () => setError(null) };
}
