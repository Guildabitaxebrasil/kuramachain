import type { RpcStatus } from '../../types/defi';

const STYLES: Record<RpcStatus, { dot: string; text: string; label: string }> = {
  connected: { dot: 'bg-kur-green shadow-glow-green', text: 'text-kur-green', label: 'Connected' },
  slow: { dot: 'bg-kur-yellow', text: 'text-kur-yellow', label: 'Slow' },
  offline: { dot: 'bg-kur-red', text: 'text-kur-red', label: 'Offline' },
  unknown: { dot: 'bg-kur-text-muted', text: 'text-kur-text-muted', label: 'Desconectado' },
};

interface Props {
  status: RpcStatus;
  latencyMs?: number | null;
  compact?: boolean;
}

export default function StatusPill({ status, latencyMs, compact = false }: Props) {
  const style = STYLES[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-kur-border bg-kur-bg/60 px-2 py-0.5 text-[10px] font-medium ${style.text}`}
      title={latencyMs ? `Latência ${latencyMs}ms` : undefined}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot} ${status === 'connected' ? 'animate-pulse' : ''}`} />
      {compact ? style.label : `${style.label}${latencyMs ? ` · ${latencyMs}ms` : ''}`}
    </span>
  );
}
