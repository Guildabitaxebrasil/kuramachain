import type { ReactNode } from 'react';

interface Props {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

export default function EmptyState({ icon = '🦊', title, description, action, compact = false }: Props) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl border border-dashed border-kur-border bg-kur-bg/30 text-center ${
        compact ? 'px-4 py-6' : 'px-6 py-10'
      }`}
    >
      <span className="mb-2 text-2xl opacity-80" aria-hidden>
        {icon}
      </span>
      <p className="text-sm font-medium text-kur-text">{title}</p>
      {description && (
        <p className="mt-1 max-w-md text-xs leading-relaxed text-kur-text-muted">{description}</p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

interface NotConfiguredProps {
  what: string;
  detail?: ReactNode;
  action?: ReactNode;
}

/** Contrato ausente: nunca finge que a função existe. */
export function NotConfigured({ what, detail, action }: NotConfiguredProps) {
  return (
    <div className="rounded-xl border border-kur-yellow/30 bg-kur-yellow/5 px-4 py-3">
      <p className="text-xs font-semibold text-kur-yellow">Contrato não configurado</p>
      <p className="mt-1 text-[11px] leading-relaxed text-kur-text-muted">
        {detail ?? (
          <>
            Nenhum endereço de <span className="font-mono text-kur-text">{what}</span> foi definido para
            esta rede. Configure em <span className="font-mono text-kur-text">Dashboard → Contratos</span>{' '}
            (ou via <span className="font-mono text-kur-text">VITE_*</span> na build).
          </>
        )}
      </p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Dado real indisponível (sem preço, sem histórico, RPC fora). */
export function DataUnavailable({ detail }: { detail: string }) {
  return (
    <div className="rounded-xl border border-kur-border bg-kur-bg/40 px-3 py-2 text-[11px] text-kur-text-muted">
      Dados indisponíveis — {detail}
    </div>
  );
}
