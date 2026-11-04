import { useEffect } from 'react';
import { chainName } from '../../chains/chains';
import { shortAddress } from '../../utils/format';

export interface ConfirmDetail {
  label: string;
  value: string;
  tone?: 'default' | 'positive' | 'negative' | 'warning';
}

interface Props {
  open: boolean;
  title: string;
  /** Texto explícito: “10 USDC”. */
  amountText: string;
  contractLabel: string;
  contractAddress: string;
  chainId: number;
  details?: ConfirmDetail[];
  warning?: string | null;
  busy?: boolean;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const TONE: Record<NonNullable<ConfirmDetail['tone']>, string> = {
  default: 'text-kur-text',
  positive: 'text-kur-green',
  negative: 'text-kur-red',
  warning: 'text-kur-yellow',
};

/**
 * Confirmação obrigatória antes de qualquer assinatura.
 *
 * Mostra, em texto claro: “Você está prestes a enviar X para o contrato Y na
 * rede Z” — mais o resumo (mínimo recebido, gas, etc).
 */
export default function ConfirmTxModal({
  open,
  title,
  amountText,
  contractLabel,
  contractAddress,
  chainId,
  details = [],
  warning,
  busy = false,
  confirmLabel = 'Confirmar e assinar',
  onConfirm,
  onCancel,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onCancel, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => (busy ? undefined : onCancel())}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-kur-border bg-kur-bg-card shadow-card"
      >
        <div className="border-b border-kur-border px-5 py-3">
          <h3 className="text-sm font-semibold text-kur-text">{title}</h3>
          <p className="mt-0.5 text-[10px] text-kur-text-muted">
            Revise antes de assinar — a carteira é a única que assina.
          </p>
        </div>

        <div className="space-y-3 px-5 py-4">
          <div className="rounded-xl border border-kur-border bg-kur-bg/60 p-3">
            <p className="text-xs leading-relaxed text-kur-text">
              Você está prestes a enviar{' '}
              <span className="font-semibold text-kur-accent">{amountText}</span> para o contrato{' '}
              <span className="font-semibold text-kur-text">{contractLabel}</span>
              <span className="font-mono text-[11px] text-kur-text-muted"> ({shortAddress(contractAddress, 6)})</span>{' '}
              na rede <span className="font-semibold text-kur-text">{chainName(chainId)}</span>.
            </p>
          </div>

          {details.length > 0 && (
            <div className="space-y-1 rounded-xl border border-kur-border/70 p-3">
              {details.map((detail) => (
                <div key={detail.label} className="flex items-baseline justify-between gap-3 text-[11px]">
                  <span className="text-kur-text-muted">{detail.label}</span>
                  <span className={`text-right font-medium ${TONE[detail.tone ?? 'default']}`}>
                    {detail.value}
                  </span>
                </div>
              ))}
            </div>
          )}

          {warning && (
            <p className="rounded-lg border border-kur-yellow/30 bg-kur-yellow/5 px-3 py-2 text-[11px] text-kur-yellow">
              ⚠️ {warning}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-kur-border px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-xl border border-kur-border px-4 py-2 text-xs text-kur-text-muted transition-colors hover:text-kur-text disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="btn-primary px-4 py-2 text-xs"
          >
            {busy ? 'Aguardando…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
