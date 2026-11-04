import type { ReactNode } from 'react';
import { fmtPct } from '../../utils/format';

interface Props {
  label: string;
  value: ReactNode;
  delta?: number | null;
  deltaLabel?: string;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: 'accent' | 'green' | 'red' | 'yellow' | 'violet' | 'muted';
}

const TONES: Record<NonNullable<Props['tone']>, string> = {
  accent: 'text-kur-accent',
  green: 'text-kur-green',
  red: 'text-kur-red',
  yellow: 'text-kur-yellow',
  violet: 'text-kur-violet',
  muted: 'text-kur-text',
};

export default function StatTile({ label, value, delta, deltaLabel, hint, icon, tone = 'muted' }: Props) {
  const deltaTone =
    delta === null || delta === undefined ? '' : delta >= 0 ? 'text-kur-green' : 'text-kur-red';
  return (
    <div className="group relative overflow-hidden rounded-xl border border-kur-border bg-kur-bg-card/60 p-3.5 backdrop-blur-sm transition-colors hover:border-kur-accent/40">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-medium uppercase tracking-wider text-kur-text-muted">{label}</p>
        {icon && <span className="text-sm opacity-70">{icon}</span>}
      </div>
      <p className={`mt-1.5 font-mono text-lg font-semibold leading-tight ${TONES[tone]}`}>{value}</p>
      <div className="mt-1 flex items-center gap-2 text-[11px]">
        {delta !== null && delta !== undefined && (
          <span className={`font-medium ${deltaTone}`}>
            {fmtPct(delta)}
            {deltaLabel ? ` ${deltaLabel}` : ''}
          </span>
        )}
        {hint && <span className="truncate text-kur-text-muted">{hint}</span>}
      </div>
    </div>
  );
}
