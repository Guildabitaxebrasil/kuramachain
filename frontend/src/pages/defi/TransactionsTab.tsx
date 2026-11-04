import { useState } from 'react';
import { useNetwork } from '../../context/NetworkContext';
import { useTransactions, type TxFilter } from '../../hooks/useTransactions';
import Panel from '../../components/defi/Panel';
import TxTable from '../../components/defi/TxTable';

const FILTERS: Array<{ id: TxFilter; label: string }> = [
  { id: 'all', label: 'Todas' },
  { id: 'swap', label: 'Swap' },
  { id: 'transfer', label: 'Transfer' },
  { id: 'liquidity', label: 'Liquidez' },
  { id: 'staking', label: 'Staking' },
  { id: 'lending', label: 'Lending' },
  { id: 'bridge', label: 'Bridge' },
  { id: 'approve', label: 'Approve' },
];

export default function TransactionsTab() {
  const { chainId, account, chain } = useNetwork();
  const [filter, setFilter] = useState<TxFilter>('all');
  const { transactions, all } = useTransactions(chainId, account, filter);

  return (
    <div className="space-y-4">
      <Panel
        title="Transações"
        subtitle={`${chain.name} · histórico local com status de recibo real`}
        actions={<span className="text-[10px] text-kur-text-muted">{all.length} registro(s)</span>}
      >
        <div className="mb-3 flex flex-wrap gap-1">
          {FILTERS.map((item) => {
            const count = item.id === 'all' ? all.length : all.filter((tx) => tx.kind === item.id).length;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                className={`rounded-lg px-2 py-1 text-[10px] transition-colors ${
                  filter === item.id
                    ? 'bg-kur-accent/15 text-kur-accent'
                    : 'text-kur-text-muted hover:text-kur-text'
                }`}
              >
                {item.label}
                <span className="ml-1 opacity-60">{count}</span>
              </button>
            );
          })}
        </div>
        <TxTable transactions={transactions} />
        <p className="mt-2 text-[10px] text-kur-text-muted">
          A fonte é o navegador: só entram transações assinadas por esta interface. O status é atualizado
          pelo recibo do nó (pending → confirmed/failed), nunca presumido.
        </p>
      </Panel>
    </div>
  );
}
