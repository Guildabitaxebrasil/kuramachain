import { fmtAmount, fmtPrice, fmtUsd } from '../../utils/format';

interface Props {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  symbol?: string;
  balance?: bigint | null;
  decimals?: number;
  onMax?: () => void;
  usd?: number | null;
  priceUsd?: number | null;
  error?: string | null;
  disabled?: boolean;
  placeholder?: string;
}

export default function AmountInput({
  label,
  value,
  onChange,
  symbol,
  balance,
  decimals = 18,
  onMax,
  usd,
  priceUsd,
  error,
  disabled,
  placeholder = '0.0',
}: Props) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        {label && <span className="text-[11px] text-kur-text-muted">{label}</span>}
        {balance !== undefined && balance !== null && (
          <button
            type="button"
            onClick={onMax}
            disabled={!onMax}
            className="text-[10px] text-kur-text-muted transition-colors hover:text-kur-accent disabled:cursor-default"
            title="Usar saldo máximo"
          >
            saldo: {fmtAmount(balance, decimals, 6)} {symbol}
          </button>
        )}
      </div>
      <div
        className={`flex items-center gap-2 rounded-xl border bg-kur-bg-hover/50 px-3 py-2.5 transition-colors ${
          error ? 'border-kur-red/60' : 'border-kur-border focus-within:border-kur-accent/60'
        }`}
      >
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          inputMode="decimal"
          placeholder={placeholder}
          disabled={disabled}
          className="min-w-0 flex-1 bg-transparent font-mono text-base text-kur-text outline-none placeholder:text-kur-text-muted/40 disabled:opacity-60"
        />
        {symbol && <span className="shrink-0 text-xs font-medium text-kur-text-muted">{symbol}</span>}
        {onMax && (
          <button
            type="button"
            onClick={onMax}
            disabled={disabled}
            className="shrink-0 rounded-md border border-kur-accent/30 bg-kur-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-kur-accent disabled:opacity-40"
          >
            MAX
          </button>
        )}
      </div>
      <div className="mt-1 flex items-center justify-between gap-2 text-[10px]">
        <span className={error ? 'text-kur-red' : 'text-kur-text-muted'}>
          {error ?? (usd !== null && usd !== undefined ? `≈ ${fmtUsd(usd, { compact: false })}` : '')}
        </span>
        {priceUsd !== null && priceUsd !== undefined && (
          <span className="text-kur-text-muted">1 {symbol} = {fmtPrice(priceUsd)}</span>
        )}
      </div>
    </div>
  );
}
