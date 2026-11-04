import { useMemo, useSyncExternalStore } from 'react';
import type { TxKind, TxRecord } from '../types/defi';
import {
  listTransactions,
  subscribeTransactions,
  transactionsVersion,
} from '../services/txStore';

export type TxFilter = 'all' | TxKind;

export function useTransactions(
  chainId: number,
  account: string | null,
  filter: TxFilter = 'all',
): { transactions: TxRecord[]; all: TxRecord[] } {
  const version = useSyncExternalStore(
    subscribeTransactions,
    transactionsVersion,
    transactionsVersion,
  );
  const all = useMemo(
    () => listTransactions(chainId, account),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chainId, account, version],
  );
  const transactions = filter === 'all' ? all : all.filter((tx) => tx.kind === filter);
  return { transactions, all };
}
