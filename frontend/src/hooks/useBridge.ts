import { useCallback, useState } from 'react';
import {
  bridgeDeposit,
  loadBridgeDeposits,
  loadBridgeState,
  type BridgeResult,
} from '../services/bridge';
import { useAsync, errorMessage } from './useAsync';

export function useBridge(chainId: number, token: string | undefined, pollMs = 30_000) {
  const state = useAsync(
    () => loadBridgeState(chainId, token),
    [chainId, token],
    { pollMs },
  );
  const deposits = useAsync(
    () => loadBridgeDeposits(chainId),
    [chainId],
    { pollMs: 60_000, enabled: state.data?.configured === true },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deposit = useCallback(
    async (
      account: string,
      asset: string,
      amount: bigint,
      destChain: number,
      recipient: string,
    ): Promise<BridgeResult | null> => {
      setBusy(true);
      setError(null);
      try {
        const result = await bridgeDeposit(chainId, account, asset, amount, destChain, recipient);
        state.refresh();
        deposits.refresh();
        return result;
      } catch (err) {
        setError(errorMessage(err));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [chainId, deposits, state],
  );

  return { ...state, deposits: deposits.data ?? [], busy, error, deposit };
}
