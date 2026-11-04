import { useEffect, useMemo, useRef, useState } from 'react';
import type { TokenConfig } from '../../types/defi';
import { addCustomToken, isNativeToken, removeCustomToken } from '../../tokens/registry';
import { useTokenBalances } from '../../hooks/useTokenBalances';
import { fmtAmount, shortAddress } from '../../utils/format';
import { isAddress } from '../../abi/coders';

interface Props {
  chainId: number;
  tokens: TokenConfig[];
  value: string;
  onChange: (address: string) => void;
  account?: string | null;
  label?: string;
  exclude?: string;
  disabled?: boolean;
}

/** Seletor de token com busca, saldo on-chain e cadastro de token customizado. */
export default function TokenSelect({
  chainId,
  tokens,
  value,
  onChange,
  account,
  label,
  exclude,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newAddress, setNewAddress] = useState('');
  const [newSymbol, setNewSymbol] = useState('');
  const [newDecimals, setNewDecimals] = useState('18');
  const [formError, setFormError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const selected = tokens.find((token) => token.address.toLowerCase() === value.toLowerCase());
  const addresses = useMemo(() => tokens.map((token) => token.address), [tokens]);
  const balances = useTokenBalances(chainId, account ?? null, addresses, 20_000);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const filtered = tokens.filter((token) => {
    if (exclude && token.address.toLowerCase() === exclude.toLowerCase()) return false;
    const search = query.trim().toLowerCase();
    if (!search) return true;
    return (
      token.symbol.toLowerCase().includes(search) ||
      token.name.toLowerCase().includes(search) ||
      token.address.toLowerCase().includes(search)
    );
  });

  const submitCustom = () => {
    setFormError(null);
    try {
      addCustomToken(chainId, {
        address: newAddress.trim(),
        symbol: newSymbol,
        decimals: Number(newDecimals),
      });
      onChange(newAddress.trim());
      setShowAdd(false);
      setNewAddress('');
      setNewSymbol('');
      setNewDecimals('18');
      setOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Falha ao adicionar token');
    }
  };

  return (
    <div ref={boxRef} className="relative">
      {label && <span className="mb-1 block text-[11px] text-kur-text-muted">{label}</span>}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-2 rounded-xl border border-kur-border bg-kur-bg-hover/60 px-3 py-2.5 text-left text-sm text-kur-text transition-colors hover:border-kur-accent/50 disabled:opacity-60"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-kur-accent/15 text-[10px] font-bold text-kur-accent">
          {selected?.symbol.slice(0, 2) ?? '?'}
        </span>
        <span className="flex-1 truncate font-medium">{selected?.symbol ?? 'Selecionar token'}</span>
        <svg className="h-3 w-3 opacity-60" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path d="M5.5 7.5 10 12l4.5-4.5" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 right-0 z-40 mt-2 overflow-hidden rounded-xl border border-kur-border bg-kur-bg-card/95 shadow-card backdrop-blur-xl">
          <div className="border-b border-kur-border/70 p-2">
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por símbolo, nome ou endereço"
              className="w-full rounded-lg border border-kur-border bg-kur-bg/70 px-2.5 py-1.5 text-xs text-kur-text placeholder-kur-text-muted/60 focus:border-kur-accent/60 focus:outline-none"
            />
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <li className="px-3 py-3 text-center text-[11px] text-kur-text-muted">
                Nenhum token encontrado
              </li>
            )}
            {filtered.map((token) => {
              const entry = balances.data?.[token.address.toLowerCase()];
              return (
                <li key={`${token.chainId}:${token.address}`} className="group flex items-center">
                  <button
                    type="button"
                    onClick={() => {
                      onChange(token.address);
                      setOpen(false);
                      setQuery('');
                    }}
                    className="flex flex-1 items-center gap-2 px-3 py-2 text-left text-xs text-kur-text transition-colors hover:bg-kur-bg-hover"
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-kur-accent/10 text-[10px] font-bold text-kur-accent">
                      {token.symbol.slice(0, 2)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="font-medium">{token.symbol}</span>
                        {!token.verified && (
                          <span className="rounded bg-kur-yellow/10 px-1 text-[9px] text-kur-yellow">
                            custom
                          </span>
                        )}
                        {isNativeToken(token.address) && (
                          <span className="rounded bg-kur-green/10 px-1 text-[9px] text-kur-green">
                            nativo
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-[10px] text-kur-text-muted">
                        {token.name} · {shortAddress(token.address, 4)}
                      </span>
                    </span>
                    <span className="text-right font-mono text-[10px] text-kur-text-muted">
                      {entry ? fmtAmount(entry.balance, token.decimals, 4) : '—'}
                    </span>
                  </button>
                  {token.tags.includes('custom') && (
                    <button
                      type="button"
                      onClick={() => removeCustomToken(chainId, token.address)}
                      className="px-2 text-[10px] text-kur-red opacity-0 transition-opacity group-hover:opacity-100"
                      title="Remover token customizado"
                    >
                      ✕
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="border-t border-kur-border/70 p-2">
            {!showAdd ? (
              <button
                type="button"
                onClick={() => setShowAdd(true)}
                className="w-full rounded-lg border border-kur-border px-2 py-1.5 text-[11px] text-kur-text-muted transition-colors hover:border-kur-accent/50 hover:text-kur-accent"
              >
                + Adicionar token por endereço
              </button>
            ) : (
              <div className="space-y-1.5">
                <input
                  value={newAddress}
                  onChange={(event) => setNewAddress(event.target.value)}
                  placeholder="0x… endereço do contrato"
                  className="w-full rounded-lg border border-kur-border bg-kur-bg/70 px-2 py-1.5 font-mono text-[11px] text-kur-text focus:border-kur-accent/60 focus:outline-none"
                />
                <div className="flex gap-1.5">
                  <input
                    value={newSymbol}
                    onChange={(event) => setNewSymbol(event.target.value.toUpperCase())}
                    placeholder="SÍMBOLO"
                    className="w-24 rounded-lg border border-kur-border bg-kur-bg/70 px-2 py-1.5 text-[11px] text-kur-text focus:border-kur-accent/60 focus:outline-none"
                  />
                  <input
                    value={newDecimals}
                    onChange={(event) => setNewDecimals(event.target.value)}
                    placeholder="decimais"
                    inputMode="numeric"
                    className="w-20 rounded-lg border border-kur-border bg-kur-bg/70 px-2 py-1.5 text-[11px] text-kur-text focus:border-kur-accent/60 focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={!isAddress(newAddress.trim()) || !newSymbol.trim()}
                    onClick={submitCustom}
                    className="flex-1 rounded-lg bg-kur-accent/15 px-2 py-1.5 text-[11px] font-medium text-kur-accent disabled:opacity-40"
                  >
                    Adicionar
                  </button>
                </div>
                {formError && <p className="text-[10px] text-kur-red">{formError}</p>}
                <p className="text-[9px] leading-snug text-kur-text-muted">
                  Tokens manuais não são verificados — confira o endereço no explorer.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
