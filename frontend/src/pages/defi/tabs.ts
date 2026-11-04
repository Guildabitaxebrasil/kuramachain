export const DEFI_TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: '📊' },
  { id: 'swap', label: 'Swap', icon: '🔁' },
  { id: 'markets', label: 'Markets', icon: '📈' },
  { id: 'pools', label: 'Pools', icon: '💧' },
  { id: 'liquidity', label: 'Liquidez', icon: '➕' },
  { id: 'portfolio', label: 'Portfólio', icon: '💼' },
  { id: 'staking', label: 'Staking', icon: '🌱' },
  { id: 'lending', label: 'Lending', icon: '🏦' },
  { id: 'bridge', label: 'Bridge', icon: '🌉' },
  { id: 'oracle', label: 'Oráculo', icon: '🔮' },
  { id: 'analytics', label: 'Analytics', icon: '📉' },
  { id: 'transactions', label: 'Transações', icon: '🧾' },
  { id: 'intelligence', label: 'Intelligence', icon: '🧠' },
  { id: 'terminal', label: 'Terminal', icon: '🖥️' },
] as const;

export type DefiTabId = (typeof DEFI_TABS)[number]['id'];
