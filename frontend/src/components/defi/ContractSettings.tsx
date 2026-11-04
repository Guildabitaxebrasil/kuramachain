import { useState } from 'react';
import type { ContractKey } from '../../types/defi';
import { CONTRACT_KEYS, contractMeta, setContractAddress } from '../../contracts/registry';
import { useNetwork } from '../../context/NetworkContext';
import { useToast } from '../../context/ToastContext';
import { isAddress } from '../../abi/coders';
import { shortAddress } from '../../utils/format';
import Panel from './Panel';

/**
 * Registro de contratos da rede: mostra o que está configurado, a origem
 * (build/local) e permite salvar um endereço sem alterar código.
 */
export default function ContractSettings() {
  const { chainId, chain, contracts } = useNetwork();
  const { notify } = useToast();
  const [drafts, setDrafts] = useState<Partial<Record<ContractKey, string>>>({});

  const save = (key: ContractKey) => {
    const draft = (drafts[key] ?? '').trim();
    try {
      setContractAddress(chainId, key, draft);
      setDrafts((current) => ({ ...current, [key]: undefined }));
      notify('success', 'Contrato atualizado', `${contractMeta(key).label} · ${chain.name}`);
    } catch (err) {
      notify('error', 'Endereço inválido', err instanceof Error ? err.message : undefined);
    }
  };

  return (
    <Panel
      title="Contratos da rede"
      subtitle={`${chain.name} (${chain.id}) · endereço, versão e status`}
    >
      <div className="space-y-2">
        {CONTRACT_KEYS.map((key) => {
          const entry = contracts[key];
          const meta = contractMeta(key);
          const draft = drafts[key] ?? '';
          return (
            <div
              key={key}
              className="grid gap-2 rounded-xl border border-kur-border/70 bg-kur-bg/30 p-2.5 sm:grid-cols-[1.1fr_1.4fr_auto]"
            >
              <div className="min-w-0">
                <p className="truncate text-[11px] font-medium text-kur-text">{meta.label}</p>
                <p className="mt-0.5 text-[9px] text-kur-text-muted">
                  v{meta.version} · <span className="font-mono">{meta.env}</span>
                </p>
              </div>
              <div className="min-w-0">
                <input
                  value={draft || entry.address}
                  onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))}
                  placeholder="0x… (não configurado)"
                  className="w-full rounded-lg border border-kur-border bg-kur-bg/70 px-2 py-1.5 font-mono text-[10px] text-kur-text placeholder-kur-text-muted/50 focus:border-kur-accent/60 focus:outline-none"
                  aria-label={`Endereço de ${meta.label}`}
                />
                <p className="mt-0.5 text-[9px] text-kur-text-muted">
                  {entry.enabled ? (
                    <>
                      {entry.source === 'env' ? 'env da build' : entry.source === 'local' ? 'salvo na interface' : 'padrão conhecido'}
                      {' · '}
                      <span className="text-kur-green">habilitado</span>
                    </>
                  ) : (
                    <span className="text-kur-yellow">não configurado</span>
                  )}
                </p>
              </div>
              <div className="flex items-start gap-1">
                <button
                  type="button"
                  onClick={() => save(key)}
                  disabled={!draft || !isAddress(draft.trim())}
                  className="rounded-lg border border-kur-accent/30 bg-kur-accent/10 px-2 py-1.5 text-[10px] text-kur-accent disabled:opacity-40"
                >
                  Salvar
                </button>
                {entry.source === 'local' && (
                  <button
                    type="button"
                    onClick={() => {
                      setContractAddress(chainId, key, '');
                      setDrafts((current) => ({ ...current, [key]: undefined }));
                    }}
                    className="rounded-lg border border-kur-border px-2 py-1.5 text-[10px] text-kur-text-muted hover:text-kur-text"
                    title="Remover endereço salvo nesta interface"
                  >
                    Limpar
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-kur-text-muted">
        Contratos da KuramaChain ({shortAddress(contracts.router.address || '—', 6)} router) vêm de{' '}
        <code>VITE_KUR_*</code> ou do que você salva aqui. Nada é inventado: sem endereço válido a aba
        mostra “Contrato não configurado”. Uniswap V3 usa endereços comprovados (factory canônica,
        SwapRouter02/QuoterV2 na Polygon).
      </p>
    </Panel>
  );
}
