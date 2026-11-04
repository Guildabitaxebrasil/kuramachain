import { useMemo, useState } from 'react';
import type { LendingReserve } from '../../types/defi';
import { parseUnits } from '../../api/dex';
import { useNetwork } from '../../context/NetworkContext';
import { useToast } from '../../context/ToastContext';
import { useLending, type LendingActionKind } from '../../hooks/useLending';
import { useTokenBalances } from '../../hooks/useTokenBalances';
import { addTransaction, trackTransaction } from '../../services/txStore';
import AmountInput from '../../components/defi/AmountInput';
import ConfirmTxModal from '../../components/defi/ConfirmTxModal';
import EmptyState, { NotConfigured } from '../../components/defi/EmptyState';
import InfoRow from '../../components/defi/InfoRow';
import Panel from '../../components/defi/Panel';
import StatTile from '../../components/defi/StatTile';
import { fmtAmount, fmtApr, fmtUsd, toAmountString } from '../../utils/format';

const ACTIONS: Array<{ id: LendingActionKind; label: string }> = [
  { id: 'supply', label: 'Supply' },
  { id: 'withdraw', label: 'Withdraw' },
  { id: 'borrow', label: 'Borrow' },
  { id: 'repay', label: 'Repay' },
];

export default function LendingTab() {
  const { chainId, account, chain, contracts } = useNetwork();
  const { notify } = useToast();
  const lending = useLending(chainId, account);
  const [action, setAction] = useState<LendingActionKind>('supply');
  const [selectedAsset, setSelectedAsset] = useState<string>('');
  const [amount, setAmount] = useState('');
  const [confirm, setConfirm] = useState(false);

  const reserves = lending.data?.reserves ?? [];
  const reserve: LendingReserve | null = useMemo(
    () => reserves.find((item) => item.asset.address === selectedAsset) ?? reserves[0] ?? null,
    [reserves, selectedAsset],
  );

  const balances = useTokenBalances(
    chainId,
    account,
    reserve ? [reserve.asset.address] : [],
    15_000,
  );
  const wallet = reserve ? balances.data?.[reserve.asset.address.toLowerCase()]?.balance ?? 0n : 0n;
  const amountWei = (() => {
    if (!reserve) return 0n;
    try {
      return amount.trim() ? parseUnits(amount, reserve.asset.decimals) : 0n;
    } catch {
      return 0n;
    }
  })();

  if (!contracts.lendingPool.enabled) {
    return (
      <Panel title="Lending" subtitle={chain.name}>
        <NotConfigured what="KurLendingPool" />
      </Panel>
    );
  }

  const run = async () => {
    if (!reserve || !account) return;
    setConfirm(false);
    const result = await lending.act(action, reserve.asset.address, amountWei);
    if (!result) return;
    addTransaction({
      hash: result.tx,
      chainId,
      account,
      kind: 'lending',
      description: `${action} ${fmtAmount(amountWei, reserve.asset.decimals, 4)} ${reserve.asset.symbol}`,
      to: contracts.lendingPool.address,
      contract: contracts.lendingPool.address,
    });
    const status = await trackTransaction(chainId, account, result.tx);
    notify(
      status === 'failed' ? 'error' : 'success',
      status === 'failed' ? 'Operação revertida' : `Lending: ${action} confirmado`,
      result.tx,
    );
    setAmount('');
  };

  const accountData = lending.data?.account;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Colateral"
          value={fmtUsd(accountData?.collateralUsd ?? null)}
          icon="🔐"
          tone="accent"
        />
        <StatTile label="Dívida" value={fmtUsd(accountData?.debtUsd ?? null)} icon="📉" tone="red" />
        <StatTile
          label="Health factor"
          value={accountData?.healthFactor ? accountData.healthFactor.toFixed(3) : accountData?.hasDebt === false ? '∞' : '—'}
          hint={accountData ? `limiar ${(accountData.liquidationThresholdBps / 100).toFixed(1)}%` : undefined}
          tone={(accountData?.healthFactor ?? 2) < 1 ? 'red' : 'green'}
        />
        <StatTile
          label="Pode emprestar"
          value={fmtUsd(accountData?.availableBorrowUsd ?? null)}
          hint={accountData ? `LTV ${(accountData.ltvBps / 100).toFixed(1)}%` : undefined}
          icon="🏦"
        />
      </div>

      <Panel
        title="Lending"
        subtitle={`${chain.name} · KurLendingPool · close factor ${lending.data?.closeFactorBps ? lending.data.closeFactorBps / 100 : '—'}%`}
      >
        {lending.error ? (
          <NotConfigured what="KurLendingPool" detail={lending.error} />
        ) : reserves.length === 0 ? (
          <EmptyState
            icon="🏦"
            title="Nenhuma reserva inicializada"
            description="O pool está configurado, mas nenhum ativo foi habilitado via initReserve (owner)."
          />
        ) : (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-kur-text-muted">
                  <th className="px-2 py-2 font-medium">Ativo</th>
                  <th className="px-2 py-2 font-medium">Supply APY</th>
                  <th className="px-2 py-2 font-medium">Borrow APY</th>
                  <th className="px-2 py-2 font-medium">Disponível</th>
                  <th className="px-2 py-2 font-medium">Total supply</th>
                  <th className="px-2 py-2 font-medium">Total borrow</th>
                  <th className="px-2 py-2 font-medium">Utilização</th>
                  <th className="px-2 py-2 font-medium">Minha posição</th>
                </tr>
              </thead>
              <tbody>
                {reserves.map((item) => (
                  <tr
                    key={item.asset.address}
                    onClick={() => setSelectedAsset(item.asset.address)}
                    className={`cursor-pointer border-t border-kur-border/60 ${
                      reserve?.asset.address === item.asset.address ? 'bg-kur-accent/5' : 'hover:bg-kur-bg-hover/40'
                    }`}
                  >
                    <td className="px-2 py-2">
                      <span className="font-medium text-kur-text">{item.asset.symbol}</span>
                      <span className="block text-[9px] text-kur-text-muted">
                        LTV {(item.ltvBps / 100).toFixed(0)}% · liq {(item.thresholdBps / 100).toFixed(0)}%
                      </span>
                    </td>
                    <td className="px-2 py-2 font-mono text-[10px] text-kur-green">{fmtApr(item.supplyApyPct)}</td>
                    <td className="px-2 py-2 font-mono text-[10px] text-kur-red">{fmtApr(item.borrowApyPct)}</td>
                    <td className="px-2 py-2 font-mono text-[10px] text-kur-text-muted">
                      {fmtAmount(item.available, item.asset.decimals, 2)}
                    </td>
                    <td className="px-2 py-2 font-mono text-[10px] text-kur-text-muted">
                      {fmtAmount(item.supplied, item.asset.decimals, 2)}
                    </td>
                    <td className="px-2 py-2 font-mono text-[10px] text-kur-text-muted">
                      {fmtAmount(item.borrowed, item.asset.decimals, 2)}
                    </td>
                    <td className="px-2 py-2 font-mono text-[10px] text-kur-text">
                      {item.utilizationPct === null ? '—' : `${item.utilizationPct.toFixed(1)}%`}
                    </td>
                    <td className="px-2 py-2 font-mono text-[10px]">
                      <span className="text-kur-green">{fmtAmount(item.mySupplied, item.asset.decimals, 2)}</span>
                      <span className="block text-kur-red">{fmtAmount(item.myDebt, item.asset.decimals, 2)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[10px] text-kur-text-muted">
          Valores em USD usam o <code>KurPriceOracle</code> do pool (18 decimais). Preço obsoleto reverte no
          contrato, então a UI nunca calcula colateral com preço velho.
        </p>
      </Panel>

      {reserve && (
        <Panel title={`${action} — ${reserve.asset.symbol}`} subtitle="Operações assinadas pela carteira">
          <div className="grid gap-4 lg:grid-cols-[1fr_0.8fr]">
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1">
                {ACTIONS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setAction(item.id);
                      setAmount('');
                    }}
                    className={`rounded-lg px-2 py-1 text-[10px] transition-colors ${
                      action === item.id
                        ? 'bg-kur-accent/15 text-kur-accent'
                        : 'text-kur-text-muted hover:text-kur-text'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <AmountInput
                label="Quantidade"
                value={amount}
                onChange={setAmount}
                symbol={reserve.asset.symbol}
                decimals={reserve.asset.decimals}
                balance={action === 'withdraw' ? reserve.mySupplied : action === 'repay' ? reserve.myDebt : wallet}
                onMax={() => {
                  const max = action === 'withdraw' ? reserve.mySupplied : action === 'repay' ? reserve.myDebt : wallet;
                  setAmount(toAmountString(max, reserve.asset.decimals));
                }}
                disabled={!account}
                usd={
                  reserve.priceUsd !== null
                    ? (Number(amountWei) / 10 ** reserve.asset.decimals) * reserve.priceUsd
                    : null
                }
                priceUsd={reserve.priceUsd}
              />
              {(action === 'withdraw' || action === 'repay') && (
                <button
                  type="button"
                  onClick={() =>
                    setAmount(
                      toAmountString(
                        action === 'withdraw' ? reserve.mySupplied : reserve.myDebt,
                        reserve.asset.decimals,
                      ),
                    )
                  }
                  className="text-[10px] text-kur-accent"
                >
                  usar valor máximo
                </button>
              )}
              <button
                type="button"
                disabled={!account || amountWei === 0n || lending.busy}
                onClick={() => setConfirm(true)}
                className="w-full rounded-xl bg-kur-gradient px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
              >
                {account ? `${action}` : 'Conecte a carteira'}
              </button>
              <p className="text-[9px] text-kur-text-muted">
                Supply/repay exigem approve do ativo para o pool. O contrato pode reverter se LTV/health
                factor não permitirem.
              </p>
            </div>
            <div className="rounded-xl border border-kur-border/70 bg-kur-bg/30 p-3">
              <InfoRow label="Preço do ativo" value={reserve.priceUsd ? fmtUsd(reserve.priceUsd, { decimals: 4 }) : '—'} />
              <InfoRow label="Meu supply (aToken)" value={fmtAmount(reserve.mySupplied, reserve.asset.decimals, 4)} />
              <InfoRow label="Minha dívida (debtToken)" value={fmtAmount(reserve.myDebt, reserve.asset.decimals, 4)} />
              <InfoRow label="aToken" value={reserve.aToken.slice(0, 10) + '…'} mono />
              <InfoRow label="debtToken" value={reserve.debtToken.slice(0, 10) + '…'} mono />
              <InfoRow label="Reserve factor" value={`${(reserve.reserveFactorBps / 100).toFixed(1)}%`} />
              <InfoRow label="Bônus de liquidação" value={`${((reserve.bonusBps - 10_000) / 100).toFixed(2)}%`} />
            </div>
          </div>
        </Panel>
      )}

      {reserve && (
        <ConfirmTxModal
          open={confirm}
          title={`Confirmar ${action}`}
          amountText={`${fmtAmount(amountWei, reserve.asset.decimals, 6)} ${reserve.asset.symbol}`}
          contractLabel="KurLendingPool"
          contractAddress={contracts.lendingPool.address}
          chainId={chainId}
          busy={lending.busy}
          details={[
            { label: 'Ativo', value: reserve.asset.symbol },
            { label: 'Operação', value: action },
            { label: 'Supply APY', value: fmtApr(reserve.supplyApyPct) },
            { label: 'Borrow APY', value: fmtApr(reserve.borrowApyPct) },
          ]}
          onConfirm={() => void run()}
          onCancel={() => setConfirm(false)}
        />
      )}
    </div>
  );
}
