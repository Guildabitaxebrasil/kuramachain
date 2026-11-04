import { useEffect, useMemo, useState } from 'react';
import type { SwapQuote } from '../../types/defi';
import { parseUnits } from '../../api/dex';
import { KURAMA_CHAIN_ID, explorerTxUrl } from '../../chains/chains';
import { contractAddress } from '../../contracts/registry';
import { useNetwork } from '../../context/NetworkContext';
import { useToast } from '../../context/ToastContext';
import { useGasPrice, formatGwei } from '../../hooks/useGas';
import { usePools } from '../../hooks/usePools';
import { useSwap } from '../../hooks/useSwap';
import { useTokenBalances } from '../../hooks/useTokenBalances';
import { useTokenPrice } from '../../hooks/useTokenPrice';
import { addTransaction, trackTransaction } from '../../services/txStore';
import { isNativeToken } from '../../tokens/registry';
import { fmtAmount, fmtPct, fmtPrice, fmtUsd, shortAddress, toAmountString } from '../../utils/format';
import AmountInput from './AmountInput';
import ConfirmTxModal from './ConfirmTxModal';
import EmptyState, { NotConfigured } from './EmptyState';
import InfoRow from './InfoRow';
import Panel from './Panel';
import TokenSelect from './TokenSelect';

const SLIPPAGE_PRESETS = [10, 50, 100];

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className={`flex items-center gap-1.5 text-[10px] ${ok ? 'text-kur-green' : 'text-kur-red'}`}>
      <span aria-hidden>{ok ? '✓' : '✗'}</span>
      {label}
    </li>
  );
}

/**
 * Swap do DEX da Kurama.
 *
 * Mostra rota escolhida, alternativas, mínimo recebido, impacto, taxa, gas,
 * allowance e simulação saldo-antes/depois. A assinatura só acontece depois da
 * confirmação explícita (“enviar X para o contrato Y”).
 */
export default function SwapPanel({ compact = false }: { compact?: boolean }) {
  const { chainId, tokens, account, connect, chain } = useNetwork();
  const { notify } = useToast();
  const pools = usePools(chainId, account);
  const swap = useSwap(chainId, account, pools.data ?? undefined);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [slippageDraft, setSlippageDraft] = useState('50');

  const { tokenIn, tokenOut, amount, quote, step, error, warning, result, busy } = swap;

  const addresses = useMemo(
    () => [tokenIn, tokenOut].filter((address) => !!address),
    [tokenIn, tokenOut],
  );
  const balances = useTokenBalances(chainId, account, addresses);
  const priceIn = useTokenPrice(chainId, tokenIn || undefined);
  const gas = useGasPrice(chainId);

  const erc20Tokens = useMemo(() => tokens.filter((token) => !isNativeToken(token.address)), [tokens]);

  useEffect(() => {
    if (chainId !== KURAMA_CHAIN_ID) return;
    if (!erc20Tokens.length) return;
    const known = (address: string) =>
      erc20Tokens.some((token) => token.address.toLowerCase() === address.toLowerCase());
    const first = erc20Tokens[0].address;
    const nextIn = tokenIn && known(tokenIn) ? tokenIn : first;
    if (nextIn !== tokenIn) swap.setTokenIn(nextIn);
    if (!tokenOut || !known(tokenOut) || tokenOut.toLowerCase() === nextIn.toLowerCase()) {
      const second = erc20Tokens.find((token) => token.address.toLowerCase() !== nextIn.toLowerCase());
      if (second) swap.setTokenOut(second.address);
    }
  }, [chainId, erc20Tokens, tokenIn, tokenOut, swap]);

  const metaIn = tokens.find((token) => token.address.toLowerCase() === tokenIn.toLowerCase());
  const metaOut = tokens.find((token) => token.address.toLowerCase() === tokenOut.toLowerCase());
  const balanceIn = balances.data?.[tokenIn.toLowerCase()]?.balance ?? null;
  const balanceOut = balances.data?.[tokenOut.toLowerCase()]?.balance ?? null;

  let amountInWei = 0n;
  try {
    if (metaIn && amount.trim()) amountInWei = parseUnits(amount, metaIn.decimals);
  } catch {
    amountInWei = 0n;
  }

  const usdIn =
    priceIn.data?.usd !== null && priceIn.data?.usd !== undefined && metaIn
      ? (Number(amountInWei) / 10 ** metaIn.decimals) * priceIn.data.usd
      : null;

  const insufficient = balanceIn !== null && amountInWei > balanceIn;
  const validChain = chainId === KURAMA_CHAIN_ID;
  const router = contractAddress(chainId, 'router');
  const priceImpactHigh = quote?.priceImpactPct !== null && (quote?.priceImpactPct ?? 0) >= 5;
  const slippageTooHigh = swap.slippageBps > 500;

  const afterIn = balanceIn !== null && amountInWei <= balanceIn ? balanceIn - amountInWei : null;
  const afterOut = balanceOut !== null && quote ? balanceOut + quote.amountOut : null;

  const canSwap =
    validChain &&
    !!router &&
    !!account &&
    !!quote &&
    amountInWei > 0n &&
    !insufficient &&
    !busy;

  const buttonLabel = (() => {
    if (!validChain) return 'Rede sem swap configurado';
    if (!router) return 'KurRouter não configurado';
    if (!account) return 'Conectar carteira';
    if (step === 'approving') return 'Aprovando…';
    if (step === 'swapping') return 'Assinando…';
    if (step === 'confirming') return 'Aguardando recibo…';
    if (step === 'quoting') return 'Cotando…';
    if (!amount) return 'Informe a quantidade';
    if (insufficient) return `Saldo insuficiente de ${metaIn?.symbol ?? 'token'}`;
    if (quote?.needsApproval) return 'Aprovar e trocar';
    return 'Trocar';
  })();

  const applySlippage = (bps: number) => {
    swap.setSlippageBps(bps);
    setSlippageDraft(String(bps));
  };

  const execute = async () => {
    setConfirmOpen(false);
    const execution = await swap.execute();
    if (!execution || !quote || !account) return;
    if (execution.approveTx) {
      addTransaction({
        hash: execution.approveTx,
        chainId,
        account,
        kind: 'approve',
        description: `Aprovar ${quote.tokenIn.symbol} para o KurRouter`,
        to: quote.tokenIn.address,
        contract: router,
      });
      void trackTransaction(chainId, account, execution.approveTx);
    }
    addTransaction({
      hash: execution.swapTx,
      chainId,
      account,
      kind: 'swap',
      description: `Swap ${fmtAmount(quote.amountIn, quote.tokenIn.decimals, 4)} ${quote.tokenIn.symbol} → ${fmtAmount(quote.amountOut, quote.tokenOut.decimals, 4)} ${quote.tokenOut.symbol}`,
      to: router,
      contract: router,
      tokenIn: quote.tokenIn,
      tokenOut: quote.tokenOut,
      amountIn: fmtAmount(quote.amountIn, quote.tokenIn.decimals, 6),
      amountOut: fmtAmount(quote.amountOut, quote.tokenOut.decimals, 6),
    });
    const status = await trackTransaction(chainId, account, execution.swapTx);
    if (execution.status === 'failed' || status === 'failed') {
      notify('error', 'Swap revertido on-chain', execution.swapTx);
    } else {
      notify(
        'success',
        execution.status === 'pending' ? 'Swap enviado' : 'Swap confirmado',
        `${fmtAmount(quote.amountOut, quote.tokenOut.decimals, 4)} ${quote.tokenOut.symbol} · ${execution.swapTx}`,
      );
    }
    pools.refresh();
    balances.refresh();
  };

  if (chainId !== KURAMA_CHAIN_ID) {
    return (
      <Panel title="Swap" subtitle={`${chain.name} · ${chainId}`}>
        <EmptyState
          icon="⛓️"
          title={`Swap do KurRouter não está disponível em ${chain.name}`}
          description="A execução do DEX próprio só existe na KuramaChain (9090). Na Polygon o swap usa os pools reais da Uniswap V3 (aba Swap → Polygon)."
        />
      </Panel>
    );
  }

  return (
    <Panel
      title="Swap"
      subtitle="KurFactory · AMM x*y=k · 0,30% por salto"
      actions={
        <div className="flex items-center gap-1 text-[10px] text-kur-text-muted">
          <span>gas</span>
          <span className="font-mono text-kur-text">{formatGwei(gas.data)}</span>
        </div>
      }
    >
      {erc20Tokens.length < 2 ? (
        <NotConfigured
          what="KurToken / par com liquidez"
          detail="O KurRouter só troca ERC-20. Configure o KurToken (ou adicione um token customizado) e crie um par com liquidez no KurFactory para habilitar o swap."
        />
      ) : (
        <div className={compact ? 'space-y-3' : 'grid gap-4 lg:grid-cols-[1.05fr_0.95fr]'}>
          <div className="space-y-3">
            <TokenSelect
              chainId={chainId}
              tokens={tokens}
              value={tokenIn}
              onChange={(address) => swap.setTokenIn(address)}
              account={account}
              label="De"
              exclude={tokenOut}
            />
            <AmountInput
              label="Quantidade"
              value={amount}
              onChange={swap.setAmount}
              symbol={metaIn?.symbol}
              decimals={metaIn?.decimals}
              balance={account ? balanceIn : null}
              onMax={
                account && metaIn && balanceIn !== null
                  ? () => swap.setAmount(toAmountString(balanceIn, metaIn.decimals))
                  : undefined
              }
              usd={usdIn}
              priceUsd={priceIn.data?.usd ?? null}
              error={insufficient ? `Saldo insuficiente (${metaIn?.symbol})` : null}
            />

            <div className="flex justify-center">
              <button
                type="button"
                onClick={swap.flip}
                className="rounded-full border border-kur-border bg-kur-bg-card p-1.5 text-kur-text-muted transition-colors hover:border-kur-accent/60 hover:text-kur-accent"
                aria-label="Inverter tokens"
              >
                ⇅
              </button>
            </div>

            <TokenSelect
              chainId={chainId}
              tokens={tokens}
              value={tokenOut}
              onChange={(address) => swap.setTokenOut(address)}
              account={account}
              label="Para"
              exclude={tokenIn}
            />
            <div className="rounded-xl border border-kur-border/70 bg-kur-bg/40 px-3 py-2">
              <p className="text-[10px] text-kur-text-muted">Recebe (estimado)</p>
              <p className="font-mono text-sm text-kur-text">
                {quote ? `${fmtAmount(quote.amountOut, quote.tokenOut.decimals, 6)} ${quote.tokenOut.symbol}` : '—'}
              </p>
              {quote && (
                <p className="mt-0.5 text-[10px] text-kur-text-muted">
                  mínimo {fmtAmount(quote.amountOutMin, quote.tokenOut.decimals, 6)} {quote.tokenOut.symbol}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-kur-text-muted">Slippage</span>
              {SLIPPAGE_PRESETS.map((bps) => (
                <button
                  key={bps}
                  type="button"
                  onClick={() => applySlippage(bps)}
                  className={`rounded-md border px-1.5 py-0.5 text-[10px] transition-colors ${
                    swap.slippageBps === bps
                      ? 'border-kur-accent/50 bg-kur-accent/15 text-kur-accent'
                      : 'border-kur-border text-kur-text-muted hover:text-kur-text'
                  }`}
                >
                  {(bps / 100).toFixed(1)}%
                </button>
              ))}
              <input
                value={slippageDraft}
                onChange={(event) => {
                  const raw = event.target.value;
                  setSlippageDraft(raw);
                  const parsed = Number(raw);
                  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 5000) swap.setSlippageBps(parsed);
                }}
                inputMode="numeric"
                className="w-14 rounded-md border border-kur-border bg-kur-bg/70 px-1.5 py-0.5 text-right font-mono text-[10px] text-kur-text focus:border-kur-accent/60 focus:outline-none"
                title="Slippage em pontos base (50 = 0,5%)"
              />
              <span className="text-[10px] text-kur-text-muted">bps</span>
            </div>

            {slippageTooHigh && (
              <p className="rounded-lg border border-kur-yellow/30 bg-kur-yellow/5 px-2 py-1 text-[10px] text-kur-yellow">
                Slippage acima de 5% — a pool pode ter pouca liquidez.
              </p>
            )}
            {(error || warning) && (
              <p
                className={`rounded-lg border px-2 py-1 text-[11px] ${
                  error
                    ? 'border-kur-red/30 bg-kur-red/5 text-kur-red'
                    : 'border-kur-yellow/30 bg-kur-yellow/5 text-kur-yellow'
                }`}
              >
                {error ?? warning}
              </p>
            )}

            <button
              type="button"
              disabled={!canSwap}
              onClick={() => (account ? setConfirmOpen(true) : void connect())}
              className="w-full rounded-xl bg-kur-gradient px-4 py-2.5 text-sm font-semibold text-white transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              {buttonLabel}
            </button>

            {result && (
              <div className="rounded-lg border border-kur-green/25 bg-kur-green/5 px-2 py-1.5 text-[10px]">
                <p className="text-kur-green">
                  {result.status === 'confirmed' ? 'Confirmado' : result.status === 'failed' ? 'Revertido' : 'Pendente'}
                </p>
                <a
                  href={explorerTxUrl(chainId, result.swapTx)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-kur-accent hover:underline"
                >
                  {result.swapTx}
                </a>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="rounded-xl border border-kur-border/70 bg-kur-bg/40 p-3">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-kur-text-muted">
                Cotação
              </p>
              <InfoRow label="Rota" value={quote?.routeLabel ?? '—'} />
              <InfoRow
                label="Melhor preço"
                value={
                  quote?.execPrice
                    ? `1 ${quote.tokenIn.symbol} = ${quote.execPrice.toLocaleString('pt-BR', { maximumSignificantDigits: 6 })} ${quote.tokenOut.symbol}`
                    : 'n/d'
                }
              />
              <InfoRow
                label="Impacto no preço"
                value={quote?.priceImpactPct !== null && quote?.priceImpactPct !== undefined ? fmtPct(quote.priceImpactPct) : '—'}
                tone={priceImpactHigh ? 'warning' : 'default'}
                hint="Diferença entre o preço médio do pool e o preço de execução."
              />
              <InfoRow
                label="Taxa do protocolo"
                value={quote ? `${(quote.protocolFeeBps / 100).toFixed(2)}%` : '—'}
              />
              <InfoRow label="Gas estimado" value={quote?.gasEstimate ? Number(quote.gasEstimate).toLocaleString() : '—'} />
              <InfoRow
                label="Allowance"
                value={
                  quote
                    ? quote.needsApproval
                      ? 'aprovação necessária'
                      : 'suficiente'
                    : '—'
                }
                tone={quote?.needsApproval ? 'warning' : 'positive'}
              />
              <InfoRow label="Deadline" value="sem deadline no contrato" tone="muted" />
              {quote && quote.alternatives.length > 0 && (
                <div className="mt-2 border-t border-kur-border/60 pt-1">
                  <p className="text-[10px] text-kur-text-muted">Outras rotas</p>
                  {quote.alternatives.map((alternative) => (
                    <div key={alternative.label} className="flex justify-between text-[10px]">
                      <span className="truncate text-kur-text-muted">{alternative.label}</span>
                      <span className="font-mono text-kur-text">
                        {fmtAmount(alternative.amountOut, quote.tokenOut.decimals, 4)} {quote.tokenOut.symbol}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {quote?.hops.map((hop, index) => (
                <div key={`${hop.pair}-${index}`} className="mt-1 flex justify-between gap-2 text-[9px] text-kur-text-muted">
                  <span>
                    {hop.tokenIn.symbol} → {hop.tokenOut.symbol}
                  </span>
                  <span className="font-mono" title={hop.pair}>
                    {shortAddress(hop.pair, 4)} · {hop.feeBps / 100}%
                  </span>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-kur-border/70 bg-kur-bg/40 p-3">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-kur-text-muted">
                Simulação (antes de assinar)
              </p>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div>
                  <p className="text-kur-text-muted">Saldo antes</p>
                  <p className="font-mono text-kur-text">
                    {metaIn && balanceIn !== null ? `${fmtAmount(balanceIn, metaIn.decimals, 4)} ${metaIn.symbol}` : '—'}
                  </p>
                  <p className="font-mono text-[9px] text-kur-text-muted">
                    {metaOut && balanceOut !== null ? `${fmtAmount(balanceOut, metaOut.decimals, 4)} ${metaOut.symbol}` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-kur-text-muted">Saldo depois</p>
                  <p className="font-mono text-kur-green">
                    {metaIn && afterIn !== null ? `${fmtAmount(afterIn, metaIn.decimals, 4)} ${metaIn.symbol}` : '—'}
                  </p>
                  <p className="font-mono text-kur-green">
                    {metaOut && afterOut !== null ? `${fmtAmount(afterOut, metaOut.decimals, 4)} ${metaOut.symbol}` : '—'}
                  </p>
                </div>
              </div>
              <div className="mt-2 space-y-0.5 text-[9px] text-kur-text-muted">
                {quote && <p>Taxa: {(quote.protocolFeeBps / 100).toFixed(2)}% · Impacto: {fmtPct(quote.priceImpactPct)}</p>}
                <p>Gas estimado: {quote?.gasEstimate ? `${Number(quote.gasEstimate).toLocaleString()} (${formatGwei(gas.data)})` : '—'}</p>
                <p className="text-kur-yellow">Valores de gas são em KUR nativo — a simulação não debita o gas.</p>
              </div>
            </div>

            <div className="rounded-xl border border-kur-border/70 bg-kur-bg/40 p-3">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-kur-text-muted">
                Verificações de segurança
              </p>
              <ul className="space-y-0.5">
                <Check ok={validChain} label={`Chain correta (${chainId})`} />
                <Check ok={!!account} label="Carteira conectada" />
                <Check ok={!!router} label="Contrato do router permitido" />
                <Check ok={amountInWei > 0n} label="Quantidade válida" />
                <Check ok={!insufficient} label="Saldo suficiente" />
                <Check ok={swap.slippageBps > 0 && swap.slippageBps <= 500} label="Slippage dentro do limite" />
                <Check ok={(quote?.priceImpactPct ?? 0) < 15} label="Impacto abaixo de 15%" />
              </ul>
            </div>
          </div>
        </div>
      )}

      {quote && account && (
        <ConfirmTxModal
          open={confirmOpen}
          title="Confirmar swap"
          amountText={`${fmtAmount(quote.amountIn, quote.tokenIn.decimals, 6)} ${quote.tokenIn.symbol}`}
          contractLabel="KurRouter"
          contractAddress={router || quote.hops[0]?.pair || ''}
          chainId={chainId}
          busy={busy}
          confirmLabel={quote.needsApproval ? 'Aprovar e trocar' : 'Assinar swap'}
          details={[
            { label: 'Recebe (mínimo)', value: `${fmtAmount(quote.amountOutMin, quote.tokenOut.decimals, 6)} ${quote.tokenOut.symbol}` },
            { label: 'Rota', value: quote.routeLabel },
            { label: 'Slippage', value: `${(quote.slippageBps / 100).toFixed(2)}%` },
            { label: 'Impacto', value: fmtPct(quote.priceImpactPct), tone: priceImpactHigh ? 'warning' : 'default' },
            { label: 'Valor em USD', value: fmtUsd(usdIn), tone: 'default' },
            { label: 'Gas estimado', value: quote.gasEstimate ? `${Number(quote.gasEstimate).toLocaleString()} (${formatGwei(gas.data)})` : '—' },
          ]}
          warning={quote.needsApproval ? 'A carteira vai pedir duas assinaturas: approve do token e o swap.' : undefined}
          onConfirm={() => void execute()}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </Panel>
  );
}
