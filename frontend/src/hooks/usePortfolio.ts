import { useEffect, useMemo } from 'react';
import {
  loadPortfolio,
  loadPortfolioHistory,
  portfolioChange,
  recordPortfolioSnapshot,
} from '../services/portfolio';
import { useAsync } from './useAsync';

export function usePortfolio(chainId: number, account: string | null, pollMs = 20_000) {
  const state = useAsync(
    () => loadPortfolio(chainId, account as string),
    [chainId, account],
    { pollMs, enabled: !!account },
  );

  useEffect(() => {
    if (account && state.data) {
      recordPortfolioSnapshot(chainId, account, state.data.totalUsd);
    }
  }, [account, chainId, state.data]);

  const history = useMemo(
    () => (account ? loadPortfolioHistory(chainId, account) : []),
    // o snapshot novo entra a cada resposta do polling
    [account, chainId, state.data],
  );

  return {
    ...state,
    history,
    change24h: portfolioChange(history, 24),
    change7d: portfolioChange(history, 24 * 7),
    change30d: portfolioChange(history, 24 * 30),
  };
}
