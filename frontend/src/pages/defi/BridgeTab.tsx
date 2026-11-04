import { useEffect, useMemo, useState } from 'react';
import { parseUnits } from '../../api/dex';
import { useNetwork } from '../../context/NetworkContext';
import { useToast } from '../../context/ToastContext';
import { useBridge } from '../../hooks/useBridge';
import { addTransaction, trackTransaction } from '../../services/txStore';
import { isNativeToken } from '../../tokens/registry';
import AmountInput from '../../components/defi/AmountInput';
import ConfirmTxModal from '../../components/defi/ConfirmTxModal';
import EmptyState, { NotConfigured } from '../../components/defi/EmptyState';
import InfoRow from '../../components/defi/InfoRow';
import Panel from '../../components/defi/Panel';
import StatusPill from '../../components/defi/StatusPill';
import TokenSelect from '../../components/defi/TokenSelect';
import { explorerTxUrl } from '../../chains/chains';
import { fmtAmount, shortAddress, shortHash } from '../../utils/format';

export default function BridgeTab() {
  const { chainId, chain, account, tokens, contracts } = useNetwork();
  const { notify } = useToast();
  const erc20 = useMemo(() => tokens.filter((token) => !isNativeToken(token.address)), [tokens]);
  const [tokenAddress, setTokenAddress] = useState<string>('');
  const [amount, setAmount] = useState('');
  const [destChain, setDestChain] = useState<number | null>(null);
  const [recipient, setRecipient] = useState('');
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (!tokenAddress && erc20.length) {
      setTokenAddress(contracts.token.enabled ? contracts.token.address : erc20[0].address);
    }
  }, [contracts.token, erc20, tokenAddress]);

  useEffect(() => {
    if (account && !recipient) setRecipient(account);
  }, [account, recipient]);

  const bridge = useBridge(chainId, tokenAddress || undefined);
  const token = tokens.find((item) => item.address.toLowerCase() === tokenAddress.toLowerCase());
  const state = bridge.data;

  useEffect(() => {
    if (state && destChain === null) {
      const enabled = state.destinations.find((destination) => destination.enabled);
      setDestChain(enabled?.chainId ?? state.destinations[0]?.chainId ?? null);
    }
  }, [destChain, state]);

  const amountWei = (() => {
    if (!token) return 0n;
    try {
      return amount.trim() ? parseUnits(amount, token.decimals) : 0n;
    } catch {
      return 0n;
    }
  })();

  const destination = state?.destinations.find((item) => item.chainId === destChain) ?? null;

  if (!contracts.bridge.enabled) {
    return (
      <Panel title="Bridge" subtitle={chain.name}>
        <NotConfigured
          what="KurBridge"
          detail="O bridge lock/mint (KurBridge + KurWrappedToken + relayer) está implementado no nó, mas nenhum endereço foi configurado para esta rede. Sem contrato não há depósito — e a interface não simula uma ponte inexistente."
        />
        <div className="mt-3 rounded-xl border border-kur-border/70 bg-kur-bg/30 p-3 text-[11px] text-kur-text-muted">
          <p className="font-medium text-kur-text">Para habilitar</p>
          <ol className="mt-1 list-decimal space-y-1 pl-4">
            <li>Deploy do <code>KurBridge</code> e do <code>KurWrappedToken</code> na chain de destino.</li>
            <li><code>registerWrapped(destChain, token, wrapped)</code> no bridge de origem.</li>
            <li>Relayer (<code>evm/bridge.py</code>) rodando contra o RPC da outra rede.</li>
          </ol>
        </div>
      </Panel>
    );
  }

  const deposit = async () => {
    if (!account || !destination || !token) return;
    setConfirm(false);
    const result = await bridge.deposit(account, token.address, amountWei, destination.chainId, recipient || account);
    if (!result) return;
    addTransaction({
      hash: result.tx,
      chainId,
      account,
      kind: 'bridge',
      description: `Bridge ${fmtAmount(amountWei, token.decimals, 4)} ${token.symbol} → ${destination.name}`,
      to: contracts.bridge.address,
      contract: contracts.bridge.address,
    });
    const status = await trackTransaction(chainId, account, result.tx);
    notify(
      status === 'failed' ? 'error' : 'success',
      status === 'failed' ? 'Depósito revertido' : 'Depósito enviado ao bridge',
      result.tx,
    );
    setAmount('');
  };

  return (
    <div className="space-y-4">
      <Panel
        title="Bridge"
        subtitle="KurBridge · lock/mint com atestação m-de-n"
        actions={
          <StatusPill
            status={state?.paused ? 'offline' : state?.paused === false ? 'connected' : 'unknown'}
            compact
          />
        }
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-2">
            <TokenSelect
              chainId={chainId}
              tokens={tokens}
              value={tokenAddress}
              onChange={setTokenAddress}
              account={account}
              label="Ativo"
            />
            <AmountInput
              label="Quantidade"
              value={amount}
              onChange={setAmount}
              symbol={token?.symbol}
              decimals={token?.decimals}
              disabled={!account}
            />
            <label className="block text-[11px] text-kur-text-muted">Destino</label>
            <select
              value={destChain ?? ''}
              onChange={(event) => setDestChain(Number(event.target.value))}
              className="w-full rounded-xl border border-kur-border bg-kur-bg-hover/60 px-3 py-2 text-xs text-kur-text focus:border-kur-accent/60 focus:outline-none"
            >
              {(state?.destinations ?? []).map((item) => (
                <option key={item.chainId} value={item.chainId}>
                  {item.name} ({item.chainId}){item.enabled ? '' : ' — sem wrapped registrado'}
                </option>
              ))}
            </select>
            <label className="block text-[11px] text-kur-text-muted">Recebedor no destino</label>
            <input
              value={recipient}
              onChange={(event) => setRecipient(event.target.value.trim())}
              placeholder="0x…"
              className="w-full rounded-xl border border-kur-border bg-kur-bg-hover/60 px-3 py-2 font-mono text-[11px] text-kur-text focus:border-kur-accent/60 focus:outline-none"
            />
            <button
              type="button"
              disabled={!account || !destination?.enabled || amountWei === 0n || bridge.busy || state?.paused === true}
              onClick={() => setConfirm(true)}
              className="w-full rounded-xl bg-kur-gradient px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
            >
              {!account
                ? 'Conecte a carteira'
                : state?.paused
                  ? 'Bridge pausado'
                  : !destination?.enabled
                    ? 'Destino sem wrapped registrado'
                    : 'Depositar no bridge'}
            </button>
            {bridge.error && <p className="text-[11px] text-kur-red">{bridge.error}</p>}
            <p className="text-[9px] text-kur-text-muted">
              O depósito trava o token na origem e emite o wrapped no destino após a atestação dos
              validadores. Sem confirmações suficientes, o wrapped não é liberado.
            </p>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl border border-kur-border/70 bg-kur-bg/30 p-3">
              <InfoRow label="Contrato" value={shortAddress(contracts.bridge.address, 6)} mono />
              <InfoRow label="localChainId" value={state?.localChainId ?? '—'} />
              <InfoRow label="Validadores" value={state?.validators ?? '—'} />
              <InfoRow label="Threshold" value={state?.threshold ?? '—'} />
              <InfoRow label="Nonce" value={state?.nonce ?? '—'} />
              <InfoRow label="Pausado" value={state?.paused === null || state?.paused === undefined ? '—' : state.paused ? 'sim' : 'não'} tone={state?.paused ? 'negative' : 'positive'} />
            </div>

            <div className="rounded-xl border border-kur-border/70 bg-kur-bg/30 p-3">
              <p className="mb-1 text-[10px] uppercase tracking-wider text-kur-text-muted">Rotas registradas</p>
              {(state?.destinations ?? []).map((item) => (
                <div key={item.chainId} className="flex items-center justify-between py-0.5 text-[10px]">
                  <span className="text-kur-text-muted">{item.name}</span>
                  {item.enabled ? (
                    <span className="font-mono text-kur-green" title={item.wrappedToken ?? ''}>
                      wrapped {shortAddress(item.wrappedToken, 4)}
                    </span>
                  ) : (
                    <span className="text-kur-yellow">não registrado</span>
                  )}
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-kur-border/70 bg-kur-bg/30 p-3">
              <p className="mb-1 text-[10px] uppercase tracking-wider text-kur-text-muted">Estimativa</p>
              <InfoRow label="Recebe" value={token && amountWei > 0n ? `${fmtAmount(amountWei, token.decimals, 6)} ${token.symbol} (1:1)` : '—'} />
              <InfoRow label="Taxa do bridge" value="sem taxa on-chain" tone="muted" />
              <InfoRow label="Gas" value="pago em KUR na origem" tone="muted" />
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="Depósitos recentes" subtitle="Eventos Deposit do KurBridge (7 dias)">
        {bridge.deposits.length ? (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-[10px]">
              <thead>
                <tr className="uppercase tracking-wider text-kur-text-muted">
                  <th className="px-2 py-2 font-medium">Deposit ID</th>
                  <th className="px-2 py-2 font-medium">De</th>
                  <th className="px-2 py-2 font-medium">Para</th>
                  <th className="px-2 py-2 font-medium">Destino</th>
                  <th className="px-2 py-2 font-medium">Nonce</th>
                  <th className="px-2 py-2 font-medium">Tx</th>
                </tr>
              </thead>
              <tbody>
                {bridge.deposits.map((item) => (
                  <tr key={`${item.depositId}-${item.nonce}`} className="border-t border-kur-border/60">
                    <td className="px-2 py-2 font-mono text-kur-text-muted">{shortHash(item.depositId)}</td>
                    <td className="px-2 py-2 font-mono text-kur-text">{shortAddress(item.sender, 4)}</td>
                    <td className="px-2 py-2 font-mono text-kur-text">{shortAddress(item.recipient, 4)}</td>
                    <td className="px-2 py-2 text-kur-text-muted">{item.destChain}</td>
                    <td className="px-2 py-2 font-mono text-kur-text-muted">{item.nonce}</td>
                    <td className="px-2 py-2">
                      <a
                        href={explorerTxUrl(chainId, item.txHash)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-kur-accent hover:underline"
                      >
                        {shortHash(item.txHash)}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState compact icon="🌉" title="Nenhum depósito na janela" description="Sem eventos Deposit do KurBridge nos últimos 7 dias." />
        )}
      </Panel>

      {token && destination && (
        <ConfirmTxModal
          open={confirm}
          title="Confirmar depósito no bridge"
          amountText={`${fmtAmount(amountWei, token.decimals, 6)} ${token.symbol}`}
          contractLabel="KurBridge"
          contractAddress={contracts.bridge.address}
          chainId={chainId}
          busy={bridge.busy}
          details={[
            { label: 'Destino', value: `${destination.name} (${destination.chainId})` },
            { label: 'Recebedor', value: shortAddress(recipient || account, 6) },
            { label: 'Wrapped no destino', value: shortAddress(destination.wrappedToken, 6) },
            { label: 'Valor recebido', value: '1:1 (lock/mint)', tone: 'positive' },
          ]}
          warning="O wrapped só é liberado após o threshold de validadores atestar o depósito."
          onConfirm={() => void deposit()}
          onCancel={() => setConfirm(false)}
        />
      )}
    </div>
  );
}
