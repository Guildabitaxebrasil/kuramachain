import type { Transaction } from '../api/types';
import TransactionRow, { TransactionCard } from './TransactionRow';

interface Props {
  transactions: Transaction[];
  loading?: boolean;
  showBlock?: boolean;
}

export default function TransactionTable({ transactions, loading }: Props) {
  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="h-12 bg-kur-bg-card rounded-xl" />
        ))}
      </div>
    );
  }

  if (!transactions.length) {
    return (
      <div className="text-center py-8 text-kur-text-muted">
        <p>Nenhuma transação encontrada</p>
      </div>
    );
  }

  return (
    <>
      {/* Mobile: cards empilhados */}
      <div className="md:hidden space-y-3">
        {transactions.map(tx => (
          <TransactionCard key={tx.transaction_id} tx={tx} />
        ))}
      </div>

      {/* Desktop: tabela com scroll horizontal quando necessário */}
      <div className="hidden md:block overflow-x-auto rounded-2xl border border-kur-border">
        <table className="w-full text-sm">
          <thead className="bg-kur-bg-hover/40">
            <tr className="border-b border-kur-border text-kur-text-muted text-xs uppercase tracking-wider">
              <th className="text-left py-3 px-4 font-medium">Hash</th>
              <th className="text-left py-3 px-4 font-medium">Remetente</th>
              <th className="text-left py-3 px-4 font-medium">Destinatário</th>
              <th className="text-right py-3 px-4 font-medium">Valor</th>
              <th className="text-right py-3 px-4 font-medium">Taxa</th>
              <th className="text-right py-3 px-4 font-medium">Data</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map(tx => (
              <TransactionRow key={tx.transaction_id} tx={tx} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
