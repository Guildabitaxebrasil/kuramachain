import { useState } from 'react';
import { NetworkProvider, useNetwork } from '../context/NetworkContext';
import { ToastProvider, useToast } from '../context/ToastContext';
import NetworkSelector from '../components/defi/NetworkSelector';
import StatusPill from '../components/defi/StatusPill';
import ContractSettings from '../components/defi/ContractSettings';
import { DEFI_TABS, type DefiTabId } from './defi/tabs';
import DashboardTab from './defi/DashboardTab';
import SwapTab from './defi/SwapTab';
import MarketsTab from './defi/MarketsTab';
import PoolsTab from './defi/PoolsTab';
import LiquidityTab from './defi/LiquidityTab';
import PortfolioTab from './defi/PortfolioTab';
import StakingTab from './defi/StakingTab';
import LendingTab from './defi/LendingTab';
import BridgeTab from './defi/BridgeTab';
import OracleTab from './defi/OracleTab';
import AnalyticsTab from './defi/AnalyticsTab';
import TransactionsTab from './defi/TransactionsTab';
import IntelligenceTab from './defi/IntelligenceTab';
import TerminalTab from './defi/TerminalTab';
import { useAsync } from '../hooks/useAsync';
import { getBlockNumber } from '../services/rpc';
import { shortAddress } from '../utils/format';

function WalletButton() {
  const { account, connect, disconnect, connecting, rpcStatus } = useNetwork();
  const { notify } = useToast();

  if (account) {
    return (
      <div className="flex items-center gap-1.5">
        <span
          className="rounded-xl border border-kur-green/30 bg-kur-green/10 px-2.5 py-1.5 font-mono text-[11px] text-kur-green"
          title={account}
        >
          {shortAddress(account, 4)}
        </span>
        <button
          type="button"
          onClick={disconnect}
          className="rounded-lg border border-kur-border px-1.5 py-1 text-[10px] text-kur-text-muted hover:text-kur-text"
          title="Desconectar (a permissão continua na wallet)"
        >
          sair
        </button>
        {rpcStatus.status === 'offline' && (
          <span className="hidden text-[10px] text-kur-red sm:inline">RPC offline</span>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={connecting}
      onClick={() =>
        void connect().catch((err: unknown) =>
          notify('error', 'Falha ao conectar', err instanceof Error ? err.message : undefined),
        )
      }
      className="btn-primary px-3 py-1.5 text-xs"
    >
      {connecting ? 'Conectando…' : 'Conectar carteira'}
    </button>
  );
}

function DefiTerminal() {
  const { chain, chainId, rpcStatus, refreshRpc, contracts, account } = useNetwork();
  const [tab, setTab] = useState<DefiTabId>('dashboard');
  const [liquidityPool, setLiquidityPool] = useState<string | null>(null);
  const block = useAsync(() => getBlockNumber(chainId), [chainId], { pollMs: 15_000 });
  const [showSettings, setShowSettings] = useState(false);

  const goToLiquidity = (poolAddress: string) => {
    setLiquidityPool(poolAddress);
    setTab('liquidity');
  };

  const renderTab = () => {
    switch (tab) {
      case 'dashboard':
        return <DashboardTab />;
      case 'swap':
        return <SwapTab />;
      case 'markets':
        return <MarketsTab />;
      case 'pools':
        return <PoolsTab onAddLiquidity={goToLiquidity} />;
      case 'liquidity':
        return <LiquidityTab initialPool={liquidityPool} />;
      case 'portfolio':
        return <PortfolioTab />;
      case 'staking':
        return <StakingTab />;
      case 'lending':
        return <LendingTab />;
      case 'bridge':
        return <BridgeTab />;
      case 'oracle':
        return <OracleTab />;
      case 'analytics':
        return <AnalyticsTab />;
      case 'transactions':
        return <TransactionsTab />;
      case 'intelligence':
        return <IntelligenceTab />;
      case 'terminal':
        return <TerminalTab />;
      default:
        return <DashboardTab />;
    }
  };

  const configured = Object.values(contracts).filter((entry) => entry.enabled).length;

  return (
    <div className="max-w-full overflow-x-hidden">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold neon-text sm:text-2xl">Kurama DeFi</h1>
            <span className="rounded-full border border-kur-accent/30 bg-kur-accent/10 px-2 py-0.5 text-[10px] text-kur-accent">
              {chain.name} · {chainId}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-kur-text-muted">
            Terminal DeFi multi-chain — dados on-chain, contratos configuráveis e nenhuma cotação simulada.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="hidden items-center gap-2 rounded-xl border border-kur-border bg-kur-bg-card/70 px-2.5 py-1.5 text-[10px] text-kur-text-muted sm:flex">
            bloco <span className="font-mono text-kur-text">{block.data ?? '—'}</span>
          </span>
          <button
            type="button"
            onClick={refreshRpc}
            className="rounded-xl border border-kur-border bg-kur-bg-card/70 px-2 py-1.5 text-[10px] text-kur-text-muted transition-colors hover:text-kur-text"
            title="Testar o RPC agora"
          >
            <StatusPill status={rpcStatus.status} latencyMs={rpcStatus.latencyMs} compact />
          </button>
          <button
            type="button"
            onClick={() => setShowSettings((value) => !value)}
            className="rounded-xl border border-kur-border bg-kur-bg-card/70 px-2 py-1.5 text-[10px] text-kur-text-muted transition-colors hover:text-kur-text"
            title="Configurar contratos"
          >
            ⚙️ {configured}/{Object.keys(contracts).length}
          </button>
          <NetworkSelector />
          <WalletButton />
        </div>
      </header>

      {rpcStatus.status === 'offline' && (
        <div className="mb-4 rounded-xl border border-kur-red/30 bg-kur-red/5 px-3 py-2 text-[11px] text-kur-red">
          RPC offline — {rpcStatus.error ?? 'sem resposta'}. Os dados podem estar desatualizados.
        </div>
      )}

      {account && chain.kind === 'kurama' && (
        <p className="mb-3 text-[10px] text-kur-text-muted">
          Dica: a carteira precisa estar na chain {chainId} para assinar. Se estiver em outra rede, use o
          seletor acima — ele troca a wallet também.
        </p>
      )}

      {showSettings && (
        <div className="mb-4">
          <ContractSettings />
        </div>
      )}

      <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-kur-border pb-2 scroll-fade">
        {DEFI_TABS.map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[11px] font-medium transition-all ${
                active
                  ? 'border-kur-accent/40 bg-kur-accent/10 text-kur-accent shadow-glow-sm'
                  : 'border-transparent text-kur-text-muted hover:bg-kur-bg-hover hover:text-kur-text'
              }`}
            >
              <span aria-hidden>{item.icon}</span>
              {item.label}
            </button>
          );
        })}
      </nav>

      <div key={tab} className="animate-fade-up pb-6">
        {renderTab()}
      </div>

      <footer className="mt-4 border-t border-kur-border pt-3 text-[10px] text-kur-text-muted">
        {chain.explorer.name} · RPC{' '}
        <span className="font-mono">{rpcStatus.url || '—'}</span> · contratos configurados{' '}
        <span className="font-mono">
          {configured}/{Object.keys(contracts).length}
        </span>{' '}
        · tudo que não tem contrato/fonte aparece como “não configurado” ou “dados indisponíveis”.
      </footer>
    </div>
  );
}

export default function DeFi() {
  return (
    <NetworkProvider>
      <ToastProvider>
        <DefiTerminal />
      </ToastProvider>
    </NetworkProvider>
  );
}
