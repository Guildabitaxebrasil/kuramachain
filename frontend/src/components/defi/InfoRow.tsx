import type { ReactNode } from 'react';

interface Props {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'positive' | 'negative' | 'warning' | 'muted';
  mono?: boolean;
}

const TONE: Record<NonNullable<Props['tone']>, string> = {
  default: 'text-kur-text',
  positive: 'text-kur-green',
  negative: 'text-kur-red',
  warning: 'text-kur-yellow',
  muted: 'text-kur-text-muted',
};

export default function InfoRow({ label, value, hint, tone = 'default', mono = false }: Props) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="text-[11px] text-kur-text-muted">
        {label}
        {hint && <span className="ml-1 cursor-help opacity-60" title={typeof hint === 'string' ? hint : undefined}>ⓘ</span>}
      </span>
      <span className={`text-right text-[11px] font-medium ${TONE[tone]} ${mono ? 'font-mono' : ''}`}>
        {value}
      </span>
    </div>
  );
}
