import type { TimeSeriesPoint } from '../../types/defi';

interface Props {
  data: TimeSeriesPoint[];
  width?: number;
  height?: number;
  color?: string;
}

/** Mini-gráfico sem dependências (usado em listas, para não montar recharts por linha). */
export default function Sparkline({ data, width = 88, height = 26, color = '#58a6ff' }: Props) {
  if (data.length < 2) {
    return <span className="text-[10px] text-kur-text-muted">—</span>;
  }
  const values = data.map((point) => point.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = data
    .map((point, index) => {
      const x = (index / (data.length - 1)) * (width - 2) + 1;
      const y = height - 2 - ((point.v - min) / span) * (height - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}
