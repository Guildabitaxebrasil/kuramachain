import type { TxKind, TxRecord } from '../../types/defi';
import { chainName } from '../../chains/chains';
import { fmtDateTime, shortAddress, shortHash } from '../../utils/format';
import EmptyState from './EmptyState';

const KIND_LABEL: Record<TxKind, string> = {
  swap: 'Swap',
  transfer: 'Transfer',
  liquidity: 'Liquidez',
  staking: 'Staking',
  lending: 'Lending',
  bridge: 'Bridge',
  approve: 'Approve',
};

const STATUS_STYLE: Record<TxRecord['status'], string> = {
  pending: 'bg-kur-yellow/10 text-kur-yellow border-kur-yellow/30',
  confirmed: 'bg-kur-green/10 text-kur-green border-kur-green/30',
  failed: 'bg-kur-red/10 text-kur-red border-kur-red/30',
};

interface Props {
  transactions: TxRecord[];
  compact?: boolean;
}

export default function TxTable({ transactions, compact = false }: Props) {
  if (!transactions.length) {
    return (
      <EmptyState
        compact
        icon="🧾"
        title="Nenhuma transação registrada"
        description="O histórico local registra apenas transações enviadas por esta interface, com status do recibo real."
      />
    );
  }

  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[680px] text-left text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-kur-text-muted">
            <th className="px-2 py-2 font-medium">Tipo</th>
            <th className="px-2 py-2 font-medium">Hash</th>
            {!compact && <th className="px-2 py-2 font-medium">Token / Qtd</th>}
            <th className="px-2 py-2 font-medium">Status</th>
            <th className="px-2 py-2 font-medium">Data</th>
            {!compact && <th className="px-2 py-2 font-medium">Origem → Destino</th>}
            <th className="px-2 py-2 font-medium">Rede</th>
            <th className="px-2 py-2 font-medium">Explorer</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx) => (
            <tr key={tx.hash} className="border-t border-kur-border/60 align-top">
              <td className="px-2 py-2">
                <span className="rounded-md bg-kur-bg-hover px-1.5 py-0.5 text-[10px] text-kur-text">
                  {KIND_LABEL[tx.kind]}
                </span>
                <p className="mt-1 max-w-[12rem] text-[10px] text-kur-text-muted">{tx.description}</p>
              </td>
              <td className="px-2 py-2 font-mono text-[10px] text-kur-accent" title={tx.hash}>
                {shortHash(tx.hash)}
              </td>
              {!compact && (
                <td className="px-2 py-2 font-mono text-[10px] text-kur-text">
                  {tx.tokenIn && tx.tokenOut
                    ? `${tx.amountIn ?? '?'} ${tx.tokenIn.symbol} → ${tx.amountOut ?? '?'} ${tx.tokenOut.symbol}`
                    : tx.amountIn ?? '—'}
                </td>
              )}
              <td className="px-2 py-2">
                <span className={`rounded-full border px-1.5 py-0.5 text-[10px] ${STATUS_STYLE[tx.status]}`}>
                  {tx.status}
                </span>
                {tx.error && <p className="mt-1 max-w-[10rem] text-[9px] text-kur-red">{tx.error}</p>}
              </td>
              <td className="px-2 py-2 text-[10px] text-kur-text-muted">
                {fmtDateTime(Math.floor(tx.createdAt / 1000))}
                {tx.gasUsed && <span className="block font-mono">{Number(tx.gasUsed).toLocaleString()} gas</span>}
              </td>
              {!compact && (
                <td className="px-2 py-2 font-mono text-[10px] text-kur-text-muted">
                  {shortAddress(tx.account)}
                  {tx.to ? ` → ${shortAddress(tx.to)}` : ''}
                </td>
              )}
              <td className="px-2 py-2 text-[10px] text-kur-text-muted">{chainName(tx.chainId)}</td>
              <td className="px-2 py-2">
                {tx.explorerUrl ? (
                  <a
                    href={tx.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] text-kur-accent hover:underline"
                  >
                    abrir ↗
                  </a>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
