import { useEffect, useRef, useState } from 'react';
import { useNetwork } from '../../context/NetworkContext';
import { useToast } from '../../context/ToastContext';
import StatusPill from './StatusPill';

/**
 * Seletor de rede do terminal.
 *
 * A troca é local (dados via RPC) e não mexe no estado das abas; se a carteira
 * estiver conectada, ela também é trocada (`wallet_switchEthereumChain`), com
 * aviso quando a wallet está em outra rede.
 */
export default function NetworkSelector() {
  const { chain, chains, chainId, switchNetwork, account, walletChainId, rpcStatus } = useNetwork();
  const { notify } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

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

  const select = async (next: number) => {
    setOpen(false);
    if (next === chainId) return;
    setBusy(true);
    try {
      await switchNetwork(next);
    } catch (err) {
      notify(
        'warning',
        'Não foi possível trocar a rede na carteira',
        err instanceof Error ? err.message : 'A leitura on-chain continua na rede selecionada.',
      );
    } finally {
      setBusy(false);
    }
  };

  const mismatch = account && walletChainId !== null && walletChainId !== chainId;

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={busy}
        className="flex items-center gap-2 rounded-xl border border-kur-border bg-kur-bg-card/80 px-3 py-2 text-xs font-medium text-kur-text transition-colors hover:border-kur-accent/50 disabled:opacity-60"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span
          className="h-2.5 w-2.5 rounded-full ring-2 ring-white/10"
          style={{ backgroundColor: chain.color }}
        />
        <span className="max-w-[8rem] truncate">{chain.name}</span>
        <span className="hidden font-mono text-[10px] text-kur-text-muted sm:inline">{chain.id}</span>
        <StatusPill status={rpcStatus.status} latencyMs={rpcStatus.latencyMs} compact />
        <svg className="h-3 w-3 opacity-60" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path d="M5.5 7.5 10 12l4.5-4.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-40 mt-2 w-72 overflow-hidden rounded-xl border border-kur-border bg-kur-bg-card/95 shadow-card backdrop-blur-xl"
        >
          <div className="border-b border-kur-border/70 px-3 py-2 text-[10px] uppercase tracking-wider text-kur-text-muted">
            Redes suportadas
          </div>
          <ul className="max-h-80 overflow-y-auto py-1">
            {chains.map((item) => {
              const active = item.id === chainId;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => void select(item.id)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${
                      active ? 'bg-kur-accent/10 text-kur-accent' : 'text-kur-text hover:bg-kur-bg-hover'
                    }`}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: item.color }}
                      aria-hidden
                    />
                    <span className="flex-1 truncate">{item.name}</span>
                    {item.kind === 'kurama' && (
                      <span className="rounded bg-kur-accent/10 px-1.5 py-0.5 text-[9px] text-kur-accent">
                        nativa
                      </span>
                    )}
                    <span className="font-mono text-[10px] text-kur-text-muted">{item.id}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-kur-border/70 px-3 py-2 text-[10px] text-kur-text-muted">
            RPC: <span className="font-mono">{rpcStatus.url || '—'}</span>
          </div>
        </div>
      )}

      {mismatch && (
        <button
          type="button"
          onClick={() => void select(chainId)}
          className="absolute right-0 top-full z-30 mt-1 whitespace-nowrap rounded-lg border border-kur-yellow/40 bg-kur-yellow/10 px-2 py-1 text-[10px] text-kur-yellow"
        >
          Wallet na chain {walletChainId} — trocar para {chain.id}
        </button>
      )}
    </div>
  );
}
