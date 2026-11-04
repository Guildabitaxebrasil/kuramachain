import { useMemo, useState } from 'react';
import type { StakingPool } from '../../types/defi';
import { parseUnits } from '../../api/dex';
import { useNetwork } from '../../context/NetworkContext';
import { useToast } from '../../context/ToastContext';
import { useStaking } from '../../hooks/useStaking';
import { useTokenBalances } from '../../hooks/useTokenBalances';
import { addTransaction, trackTransaction } from '../../services/txStore';
import AmountInput from '../../components/defi/AmountInput';
import ConfirmTxModal from '../../components/defi/ConfirmTxModal';
import EmptyState, { NotConfigured } from '../../components/defi/EmptyState';
import InfoRow from '../../components/defi/InfoRow';
import Panel from '../../components/defi/Panel';
import { fmtAmount, fmtApr, toAmountString } from '../../utils/format';

type Mode = 'stake' | 'unstake';

function apyFromApr(apr: number | null): number | null {
  if (apr === null || !Number.isFinite(apr)) return null;
  const daily = apr / 100 / 365;
  return (Math.pow(1 + daily, 365) - 1) * 100;
}

export default function StakingTab() {
  const { chainId, account, chain, contracts } = useNetwork();
  const { notify } = useToast();
  const staking = useStaking(chainId, account);
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>('stake');
  const [amount, setAmount] = useState('');
  const [confirm, setConfirm] = useState(false);

  const pools = staking.data ?? [];
  const pool: StakingPool | null = useMemo(
    () => pools.find((item) => item.pid === selectedPid) ?? pools[0] ?? null,
    [pools, selectedPid],
  );

  const balances = useTokenBalances(
    chainId,
    account,
    pool ? [pool.stakingToken.address] : [],
    15_000,
  );
  const walletBalance = pool
    ? balances.data?.[pool.stakingToken.address.toLowerCase()]?.balance ?? 0n
    : 0n;

  const amountWei = (() => {
    if (!pool) return 0n;
    try {
      return amount.trim() ? parseUnits(amount, pool.stakingToken.decimals) : 0n;
    } catch {
      return 0n;
    }
  })();

  if (!contracts.staking.enabled) {
    return (
      <Panel title="Staking" subtitle={chain.name}>
        <NotConfigured what="KurStaking" />
      </Panel>
    );
  }

  const run = async () => {
    if (!pool || !account || amountWei <= 0n) return;
    setConfirm(false);
    const result =
      mode === 'stake' ? await staking.stake(pool, amountWei) : await staking.unstake(pool, amountWei);
    if (!result) return;
    addTransaction({
      hash: result.tx,
      chainId,
      account,
      kind: 'staking',
      description:
        mode === 'stake'
          ? `Stake ${fmtAmount(amountWei, pool.stakingToken.decimals, 4)} ${pool.stakingToken.symbol} (pool #${pool.pid})`
          : `Unstake ${fmtAmount(amountWei, pool.stakingToken.decimals, 4)} ${pool.stakingToken.symbol} (pool #${pool.pid})`,
      to: contracts.staking.address,
      contract: contracts.staking.address,
    });
    const status = await trackTransaction(chainId, account, result.tx);
    notify(status === 'failed' ? 'error' : 'success', status === 'failed' ? 'Staking revertido' : 'Staking confirmado', result.tx);
    setAmount('');
  };

  const claim = async (target: StakingPool) => {
    if (!account) return;
    const result = await staking.claim(target);
    if (!result) return;
    addTransaction({
      hash: result.tx,
      chainId,
      account,
      kind: 'staking',
      description: `Claim de rewards (pool #${target.pid})`,
      to: contracts.staking.address,
      contract: contracts.staking.address,
    });
    const status = await trackTransaction(chainId, account, result.tx);
    notify(status === 'failed' ? 'error' : 'success', status === 'failed' ? 'Claim revertido' : 'Rewards resgatados', result.tx);
  };

  return (
    <div className="space-y-4">
      <Panel
        title="Staking"
        subtitle={`${chain.name} · KurStaking (recompensa por segundo)`}
        actions={<span className="text-[10px] text-kur-text-muted">{pools.length} pool(s)</span>}
      >
        {staking.error ? (
          <NotConfigured what="KurStaking" detail={staking.error} />
        ) : pools.length === 0 ? (
          <EmptyState
            icon="🌱"
            title="Nenhum pool de staking"
            description="O contrato está configurado, mas não tem pools criados. Crie um pool no KurStaking (owner) para começar."
          />
        ) : (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-kur-text-muted">
                  <th className="px-2 py-2 font-medium">Pool</th>
                  <th className="px-2 py-2 font-medium">Stake</th>
                  <th className="px-2 py-2 font-medium">Total</th>
                  <th className="px-2 py-2 font-medium">APR</th>
                  <th className="px-2 py-2 font-medium">APY</th>
                  <th className="px-2 py-2 font-medium">Meu stake</th>
                  <th className="px-2 py-2 font-medium">Pendente</th>
                  <th className="px-2 py-2 font-medium">Fim da emissão</th>
                  <th className="px-2 py-2 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {pools.map((item) => (
                  <tr
                    key={item.pid}
                    className={`border-t border-kur-border/60 ${pool?.pid === item.pid ? 'bg-kur-accent/5' : ''}`}
                  >
                    <td className="px-2 py-2 text-kur-text">#{item.pid}</td>
                    <td className="px-2 py-2">
                      <span className="font-medium text-kur-text">{item.stakingToken.symbol}</span>
                      <span className="block text-[9px] text-kur-text-muted">
                        prêmio {item.rewardToken.symbol}
                      </span>
                    </td>
                    <td className="px-2 py-2 font-mono text-[10px] text-kur-text-muted">
                      {fmtAmount(item.totalStaked, item.stakingToken.decimals, 2)}
                    </td>
                    <td className="px-2 py-2 font-mono text-[10px] text-kur-accent">{fmtApr(item.aprPct)}</td>
                    <td className="px-2 py-2 font-mono text-[10px] text-kur-green">{fmtApr(apyFromApr(item.aprPct))}</td>
                    <td className="px-2 py-2 font-mono text-[10px] text-kur-text">
                      {fmtAmount(item.myStaked, item.stakingToken.decimals, 4)}
                    </td>
                    <td className="px-2 py-2 font-mono text-[10px] text-kur-yellow">
                      {fmtAmount(item.myPending, item.rewardToken.decimals, 4)}
                    </td>
                    <td className="px-2 py-2 text-[10px] text-kur-text-muted">
                      {item.rewardEnd > 0 ? new Date(item.rewardEnd * 1000).toLocaleDateString('pt-BR') : '—'}
                      <span className="block text-[9px]">
                        orçamento {fmtAmount(item.rewardBudget, item.rewardToken.decimals, 2)}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPid(item.pid);
                            setMode('stake');
                            setAmount('');
                          }}
                          className="rounded border border-kur-accent/30 bg-kur-accent/10 px-1.5 py-0.5 text-[9px] text-kur-accent"
                        >
                          stake
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPid(item.pid);
                            setMode('unstake');
                            setAmount('');
                          }}
                          className="rounded border border-kur-border px-1.5 py-0.5 text-[9px] text-kur-text-muted"
                        >
                          unstake
                        </button>
                        <button
                          type="button"
                          disabled={staking.busy || item.myPending === 0n}
                          onClick={() => void claim(item)}
                          className="rounded border border-kur-green/30 bg-kur-green/10 px-1.5 py-0.5 text-[9px] text-kur-green disabled:opacity-40"
                        >
                          claim
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {staking.error && <p className="mt-2 text-[11px] text-kur-red">{staking.error}</p>}
        <p className="mt-2 text-[10px] text-kur-text-muted">
          APR = <code>rewardRate × 31.536.000 ÷ totalStaked</code> ajustado pelo preço on-chain dos dois
          tokens. Sem preço, o APR fica “—”. APY é o APR composto diariamente.
        </p>
      </Panel>

      {pool && (
        <Panel
          title={`${mode === 'stake' ? 'Stake' : 'Unstake'} — pool #${pool.pid}`}
          subtitle={`${pool.stakingToken.symbol} → prêmio em ${pool.rewardToken.symbol}`}
        >
          <div className="grid gap-4 lg:grid-cols-[1fr_0.8fr]">
            <div className="space-y-2">
              <AmountInput
                label={mode === 'stake' ? 'Quantidade a depositar' : 'Quantidade a retirar'}
                value={amount}
                onChange={setAmount}
                symbol={pool.stakingToken.symbol}
                decimals={pool.stakingToken.decimals}
                balance={mode === 'stake' ? walletBalance : pool.myStaked}
                onMax={() => {
                  const max = mode === 'stake' ? walletBalance : pool.myStaked;
                  setAmount(toAmountString(max, pool.stakingToken.decimals));
                }}
                disabled={!account}
              />
              <button
                type="button"
                disabled={!account || amountWei === 0n || staking.busy}
                onClick={() => setConfirm(true)}
                className="w-full rounded-xl bg-kur-gradient px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
              >
                {account ? (mode === 'stake' ? 'Fazer stake' : 'Retirar stake') : 'Conecte a carteira'}
              </button>
              <button
                type="button"
                disabled={!account || pool.myStaked === 0n || staking.busy}
                onClick={() => void staking.emergency(pool).then((result) => {
                  if (result && account) {
                    addTransaction({
                      hash: result.tx,
                      chainId,
                      account,
                      kind: 'staking',
                      description: `Emergency withdraw (pool #${pool.pid})`,
                      to: contracts.staking.address,
                      contract: contracts.staking.address,
                    });
                    void trackTransaction(chainId, account, result.tx);
                  }
                })}
                className="w-full rounded-xl border border-kur-red/30 bg-kur-red/5 px-4 py-2 text-[11px] text-kur-red disabled:opacity-40"
              >
                Emergency withdraw (sem prêmio)
              </button>
            </div>
            <div className="rounded-xl border border-kur-border/70 bg-kur-bg/30 p-3">
              <InfoRow label="Meu stake" value={`${fmtAmount(pool.myStaked, pool.stakingToken.decimals, 4)} ${pool.stakingToken.symbol}`} />
              <InfoRow label="Pendente" value={`${fmtAmount(pool.myPending, pool.rewardToken.decimals, 4)} ${pool.rewardToken.symbol}`} tone="positive" />
              <InfoRow label="Total em stake" value={fmtAmount(pool.totalStaked, pool.stakingToken.decimals, 2)} />
              <InfoRow label="rewardRate" value={`${pool.rewardRate.toString()} /s`} mono />
              <InfoRow label="Fim da emissão" value={pool.rewardEnd ? new Date(pool.rewardEnd * 1000).toLocaleString('pt-BR') : '—'} />
              <InfoRow label="Orçamento restante" value={fmtAmount(pool.rewardBudget, pool.rewardToken.decimals, 4)} />
            </div>
          </div>
        </Panel>
      )}

      {pool && (
        <ConfirmTxModal
          open={confirm}
          title={mode === 'stake' ? 'Confirmar stake' : 'Confirmar unstake'}
          amountText={`${fmtAmount(amountWei, pool.stakingToken.decimals, 6)} ${pool.stakingToken.symbol}`}
          contractLabel="KurStaking"
          contractAddress={contracts.staking.address}
          chainId={chainId}
          busy={staking.busy}
          details={[
            { label: 'Pool', value: `#${pool.pid}` },
            { label: 'APR', value: fmtApr(pool.aprPct) },
            { label: 'Recompensa', value: pool.rewardToken.symbol },
          ]}
          onConfirm={() => void run()}
          onCancel={() => setConfirm(false)}
        />
      )}
    </div>
  );
}
