import type { Transaction } from '../api/types';

interface Props {
  tx: Transaction;
  showBlock?: boolean;
}

const short = (v: string, n = 16) => (v && v.length > n ? `${v.slice(0, n)}...` : v);

export default function TransactionRow({ tx }: Props) {
  const isCoinbase = tx.sender === '0';

  return (
    <tr className="border-b border-kur-border last:border-0 hover:bg-kur-bg-hover/50 transition-colors">
      <td className="py-3 px-4">
        <div className="flex items-center gap-2">
          <p className="font-mono text-xs text-kur-accent truncate max-w-[120px]" title={tx.transaction_id}>
            {short(tx.transaction_id)}
          </p>
          {tx.evm_tx_hash && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded bg-kur-accent/10 text-kur-accent whitespace-nowrap"
              title={`Depósito na EVM: ${tx.evm_tx_hash}`}
            >
              EVM
            </span>
          )}
        </div>
      </td>
      <td className="py-3 px-4">
        {isCoinbase ? (
          <span className="text-xs bg-kur-green/10 text-kur-green px-2 py-0.5 rounded">Coinbase</span>
        ) : (
          <p className="font-mono text-xs text-kur-text truncate max-w-[120px]" title={tx.sender}>
            {short(tx.sender)}
          </p>
        )}
      </td>
      <td className="py-3 px-4">
        <p className="font-mono text-xs text-kur-text truncate max-w-[120px]" title={tx.receiver}>
          {short(tx.receiver)}
        </p>
      </td>
      <td className="py-3 px-4 text-right">
        <span className="text-sm font-mono font-medium text-kur-text">{tx.amount.toFixed(2)}</span>
      </td>
      <td className="py-3 px-4 text-right">
        <span className="text-xs font-mono text-kur-text-muted">
          {isCoinbase ? '—' : (tx.fee ?? 0).toFixed(3)}
        </span>
      </td>
      <td className="py-3 px-4 text-right">
        <span className="text-xs text-kur-text-muted">{new Date(tx.timestamp * 1000).toLocaleString('pt-BR')}</span>
      </td>
    </tr>
  );
}

/** Versão em card para telas pequenas (a tabela larga vira cards empilhados). */
export function TransactionCard({ tx }: Props) {
  const isCoinbase = tx.sender === '0';

  return (
    <div className="bg-kur-bg-card/80 border border-kur-border rounded-2xl p-4 backdrop-blur-sm shadow-card">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-xs text-kur-accent truncate" title={tx.transaction_id}>
            {short(tx.transaction_id)}
          </span>
          {tx.evm_tx_hash && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-kur-accent/10 text-kur-accent whitespace-nowrap">EVM</span>
          )}
        </div>
        <span className="text-sm font-mono font-semibold text-kur-text shrink-0">{tx.amount.toFixed(2)} KUR</span>
      </div>

      <dl className="grid grid-cols-1 gap-1.5 text-xs">
        <div className="flex justify-between gap-3">
          <dt className="text-kur-text-muted">De</dt>
          <dd className="font-mono text-kur-text truncate max-w-[60%]">
            {isCoinbase ? (
              <span className="text-kur-green">Coinbase</span>
            ) : (
              <span title={tx.sender}>{short(tx.sender)}</span>
            )}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-kur-text-muted">Para</dt>
          <dd className="font-mono text-kur-text truncate max-w-[60%]" title={tx.receiver}>{short(tx.receiver)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-kur-text-muted">Taxa</dt>
          <dd className="font-mono text-kur-text-muted">{isCoinbase ? '—' : (tx.fee ?? 0).toFixed(3)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-kur-text-muted">Data</dt>
          <dd className="text-kur-text-muted">{new Date(tx.timestamp * 1000).toLocaleString('pt-BR')}</dd>
        </div>
      </dl>
    </div>
  );
}
