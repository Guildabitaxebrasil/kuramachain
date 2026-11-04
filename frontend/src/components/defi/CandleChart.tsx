import { useEffect, useMemo, useRef, useState } from 'react';
import type { PairTrade } from '../../types/defi';
import { fmtPrice, fmtUsd } from '../../utils/format';
import EmptyState from './EmptyState';

export interface Candle {
  block: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeUsd: number | null;
}

/** Agrupa trades reais em candles OHLC (por bloco). */
export function buildCandles(trades: PairTrade[], buckets = 60): Candle[] {
  const priced = trades.filter((trade) => trade.price !== null && trade.price > 0);
  if (priced.length === 0) return [];
  const size = Math.max(1, Math.ceil(priced.length / buckets));
  const out: Candle[] = [];
  for (let i = 0; i < priced.length; i += size) {
    const slice = priced.slice(i, i + size);
    const prices = slice.map((trade) => trade.price as number);
    const volumes = slice.filter((trade) => trade.volumeUsd !== null);
    out.push({
      block: slice[slice.length - 1].blockNumber,
      open: prices[0],
      close: prices[prices.length - 1],
      high: Math.max(...prices),
      low: Math.min(...prices),
      volumeUsd: volumes.length ? volumes.reduce((sum, trade) => sum + (trade.volumeUsd ?? 0), 0) : null,
    });
  }
  return out;
}

interface Props {
  trades: PairTrade[];
  height?: number;
  pairLabel?: string;
  buckets?: number;
}

/**
 * Candlestick em SVG puro: zoom (roda do mouse), pan (arrastar) e reset
 * (duplo clique). Os dados são os eventos `Swap` do par — sem candles
 * sintéticos.
 */
export default function CandleChart({ trades, height = 320, pairLabel, buckets = 60 }: Props) {
  const candles = useMemo(() => buildCandles(trades, buckets), [trades, buckets]);
  const [view, setView] = useState({ start: 0, end: 1 });
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(720);
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; start: number; end: number } | null>(null);

  useEffect(() => {
    const element = boxRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next) setWidth(Math.max(320, next));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setView({ start: 0, end: 1 });
  }, [trades]);

  const total = candles.length;
  const startIndex = Math.max(0, Math.floor(view.start * total));
  const endIndex = Math.min(total, Math.max(startIndex + 2, Math.ceil(view.end * total)));
  const visible = candles.slice(startIndex, endIndex);

  const padding = { top: 12, right: 56, bottom: 18, left: 6 };
  const chartHeight = height;
  const volumeHeight = 48;
  const plotHeight = chartHeight - padding.top - padding.bottom - volumeHeight;
  const plotWidth = Math.max(40, width - padding.left - padding.right);

  const { min, max, maxVolume } = useMemo(() => {
    if (!visible.length) return { min: 0, max: 1, maxVolume: 1 };
    const lows = visible.map((candle) => candle.low);
    const highs = visible.map((candle) => candle.high);
    const low = Math.min(...lows);
    const high = Math.max(...highs);
    const pad = (high - low) * 0.08 || high * 0.01 || 1;
    const volumes = visible.map((candle) => candle.volumeUsd ?? 0);
    return {
      min: low - pad,
      max: high + pad,
      maxVolume: Math.max(1, ...volumes),
    };
  }, [visible]);

  if (!candles.length) {
    return (
      <EmptyState
        compact
        icon="🕯️"
        title="Sem trades no período"
        description="Nenhum evento Swap do par foi encontrado na janela consultada. O gráfico aparece quando houver negociação on-chain."
      />
    );
  }

  const xFor = (index: number) =>
    padding.left + ((index + 0.5) / visible.length) * plotWidth;
  const yFor = (price: number) =>
    padding.top + ((max - price) / (max - min || 1)) * plotHeight;

  const zoom = (factor: number, cursorRatio: number) => {
    setView((current) => {
      const span = current.end - current.start;
      const nextSpan = Math.min(1, Math.max(0.04, span * factor));
      const anchor = current.start + span * cursorRatio;
      let start = anchor - nextSpan * cursorRatio;
      start = Math.max(0, Math.min(1 - nextSpan, start));
      return { start, end: start + nextSpan };
    });
  };

  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left - padding.left) / plotWidth));
    zoom(event.deltaY > 0 ? 1.15 : 0.87, ratio);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    drag.current = { x: event.clientX, start: view.start, end: view.end };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left - padding.left) / plotWidth;
    const index = Math.floor(ratio * visible.length) + startIndex;
    setHover(index >= 0 && index < total ? index : null);

    if (!drag.current) return;
    const delta = (event.clientX - drag.current.x) / plotWidth;
    const span = drag.current.end - drag.current.start;
    let start = drag.current.start - delta * span;
    start = Math.max(0, Math.min(1 - span, start));
    setView({ start, end: start + span });
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  const active = hover !== null ? candles[hover] : candles[Math.min(total - 1, endIndex - 1)];

  return (
    <div ref={boxRef} className="select-none">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[10px] text-kur-text-muted">
        <span className="font-medium text-kur-text">
          {pairLabel ?? 'Mercado'}
          {active && (
            <span className="ml-2 font-mono text-[10px]">
              O {fmtPrice(active.open)} · H {fmtPrice(active.high)} · L {fmtPrice(active.low)} · C{' '}
              <span className={active.close >= active.open ? 'text-kur-green' : 'text-kur-red'}>
                {fmtPrice(active.close)}
              </span>
              {active.volumeUsd !== null && ` · Vol ${fmtUsd(active.volumeUsd, { compact: true })}`}
            </span>
          )}
        </span>
        <span>roda = zoom · arraste = pan · duplo clique = reset</span>
      </div>

      <div
        className="cursor-crosshair"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={() => setView({ start: 0, end: 1 })}
      >
        <svg width={width} height={chartHeight} role="img" aria-label={`Candles ${pairLabel ?? ''}`}>
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = padding.top + ratio * plotHeight;
            const price = max - ratio * (max - min);
            return (
              <g key={ratio}>
                <line
                  x1={padding.left}
                  x2={padding.left + plotWidth}
                  y1={y}
                  y2={y}
                  stroke="#243354"
                  strokeDasharray="3 3"
                />
                <text x={padding.left + plotWidth + 6} y={y + 3} fill="#8b9bb4" fontSize={11}>
                  {fmtPrice(price)}
                </text>
              </g>
            );
          })}

          {visible.map((candle, index) => {
            const x = xFor(index);
            const bodyWidth = Math.max(2, Math.min(12, plotWidth / visible.length - 2));
            const up = candle.close >= candle.open;
            const color = up ? '#3fb950' : '#f85149';
            const openY = yFor(candle.open);
            const closeY = yFor(candle.close);
            const top = Math.min(openY, closeY);
            const bodyHeight = Math.max(1, Math.abs(closeY - openY));
            const volumeBar = candle.volumeUsd === null ? 0 : (candle.volumeUsd / maxVolume) * (volumeHeight - 6);
            return (
              <g key={`${candle.block}-${index}`}>
                <line x1={x} x2={x} y1={yFor(candle.high)} y2={yFor(candle.low)} stroke={color} strokeWidth={1} />
                <rect x={x - bodyWidth / 2} y={top} width={bodyWidth} height={bodyHeight} fill={color} opacity={0.9} />
                {volumeBar > 0 && (
                  <rect
                    x={x - bodyWidth / 2}
                    y={chartHeight - padding.bottom - volumeBar}
                    width={bodyWidth}
                    height={volumeBar}
                    fill={color}
                    opacity={0.22}
                  />
                )}
                {hover === startIndex + index && (
                  <line
                    x1={x}
                    x2={x}
                    y1={padding.top}
                    y2={chartHeight - padding.bottom}
                    stroke="#58a6ff"
                    strokeDasharray="2 3"
                    opacity={0.6}
                  />
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
