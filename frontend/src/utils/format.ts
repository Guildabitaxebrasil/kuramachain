/** Formatação de valores DeFi (nunca inventa número: `null` vira “—”). */
import { formatUnits } from '../api/dex';

export { formatUnits };

export const DASH = '—';

export function fmtUsd(
  value: number | null | undefined,
  options: { compact?: boolean; decimals?: number } = {},
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  const compact = options.compact ?? Math.abs(value) >= 10_000;
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'USD',
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: options.decimals ?? (Math.abs(value) < 1 ? 4 : 2),
  });
}

export function fmtAmount(
  value: bigint | null | undefined,
  decimals: number,
  maxFraction = 6,
): string {
  if (value === null || value === undefined) return DASH;
  const text = formatUnits(value, decimals, maxFraction);
  const [whole, fraction] = text.split('.');
  const grouped = Number(whole).toLocaleString('pt-BR');
  return fraction ? `${grouped}.${fraction}` : grouped;
}

/**
 * Wei → string decimal exata (sem arredondar), para preencher inputs de "MAX".
 *
 * `fmtAmount` agrupa e corta casas; usar `.replace(/\.?0+$/, '')` nele destruiria
 * zeros inteiros ("100" viraria "1"), então este helper é o correto para inputs.
 */
export function toAmountString(value: bigint, decimals: number): string {
  if (value < 0n) return '0';
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole.toString()}.${fraction}` : whole.toString();
}

export function fmtPct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

export function fmtApr(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  return `${value.toFixed(digits)}%`;
}

export function shortAddress(address: string | null | undefined, size = 4): string {
  if (!address) return DASH;
  if (address.length <= size * 2 + 2) return address;
  return `${address.slice(0, size + 2)}…${address.slice(-size)}`;
}

export function shortHash(hash: string | null | undefined): string {
  if (!hash) return DASH;
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

export function fmtDateTime(timestampSeconds: number | null | undefined): string {
  if (!timestampSeconds) return DASH;
  return new Date(timestampSeconds * 1000).toLocaleString('pt-BR');
}

export function timeAgo(timestampSeconds: number | null | undefined): string {
  if (!timestampSeconds) return DASH;
  const diff = Math.floor(Date.now() / 1000) - timestampSeconds;
  if (diff < 0) return 'agora';
  if (diff < 60) return `há ${diff}s`;
  if (diff < 3600) return `há ${Math.floor(diff / 60)}min`;
  if (diff < 86_400) return `há ${Math.floor(diff / 3600)}h`;
  return `há ${Math.floor(diff / 86_400)}d`;
}

/** Preço com precisão adaptativa (tokens baratos precisam de mais casas). */
export function fmtPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  if (value === 0) return '$0';
  if (value >= 1) return `$${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toPrecision(4)}`;
}

export function fmtToken(value: bigint, decimals: number, symbol: string, maxFraction = 4): string {
  return `${fmtAmount(value, decimals, maxFraction)} ${symbol}`;
}
