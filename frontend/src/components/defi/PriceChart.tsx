import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TimeSeriesPoint } from '../../types/defi';
import { fmtPrice, fmtUsd } from '../../utils/format';
import EmptyState from './EmptyState';

const RANGES = [
  { label: '1h', hours: 1 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 24 * 7 },
  { label: '30d', hours: 24 * 30 },
] as const;

interface Props {
  data: TimeSeriesPoint[];
  title?: string;
  format?: 'usd' | 'price' | 'number';
  color?: string;
  height?: number;
  id: string;
}

function formatValue(value: number, format: Props['format']): string {
  if (format === 'price') return fmtPrice(value);
  if (format === 'number') return value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  return fmtUsd(value, { compact: true });
}

/** Série temporal real (snapshots/trades). Sem 2 pontos → “Histórico insuficiente”. */
export default function PriceChart({
  data,
  title,
  format = 'usd',
  color = '#58a6ff',
  height = 240,
  id,
}: Props) {
  const [range, setRange] = useState<(typeof RANGES)[number]['hours']>(24 * 7);

  const filtered = useMemo(() => {
    const cutoff = Math.floor(Date.now() / 1000) - range * 3600;
    const slice = data.filter((point) => point.t >= cutoff);
    return (slice.length >= 2 ? slice : data).map((point) => ({
      t: point.t,
      v: point.v,
      label: new Date(point.t * 1000).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
    }));
  }, [data, range]);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        {title && <p className="text-[11px] font-medium text-kur-text-muted">{title}</p>}
        <div className="flex gap-1">
          {RANGES.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => setRange(item.hours)}
              className={`rounded-md px-2 py-0.5 text-[10px] transition-colors ${
                range === item.hours
                  ? 'bg-kur-accent/15 text-kur-accent'
                  : 'text-kur-text-muted hover:text-kur-text'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length < 2 ? (
        <EmptyState
          compact
          icon="📉"
          title="Histórico insuficiente"
          description="A série é construída a partir das leituras feitas nesta interface. Deixe a página aberta para acumular pontos reais."
        />
      ) : (
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={filtered} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`grad-${id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#243354" vertical={false} />
              <XAxis
                dataKey="label"
                stroke="#8b9bb4"
                tick={{ fill: '#8b9bb4', fontSize: 12 }}
                tickLine={false}
                minTickGap={40}
              />
              <YAxis
                stroke="#8b9bb4"
                tick={{ fill: '#8b9bb4', fontSize: 12 }}
                tickLine={false}
                width={76}
                tickFormatter={(value: number) => formatValue(value, format)}
                domain={['auto', 'auto']}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0f1626',
                  border: '1px solid #243354',
                  borderRadius: '12px',
                  color: '#e6edf3',
                  fontSize: '13px',
                }}
                formatter={(value: number) => [formatValue(value, format), title ?? 'Valor']}
                labelStyle={{ color: '#8b9bb4' }}
              />
              <Area
                type="monotone"
                dataKey="v"
                stroke={color}
                strokeWidth={2}
                fill={`url(#grad-${id})`}
                dot={false}
                activeDot={{ r: 3 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
