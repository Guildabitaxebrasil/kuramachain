import { useEffect, useMemo, useState } from 'react';
import { parseUnits } from '../../api/dex';
import { useNetwork } from '../../context/NetworkContext';
import { useToast } from '../../context/ToastContext';
import { useLiquidity } from '../../hooks/useLiquidity';
import { usePools } from '../../hooks/usePools';
import { useTokenBalances } from '../../hooks/useTokenBalances';
import { addTransaction, trackTransaction } from '../../services/txStore';
import { quoteCounterpart } from '../../services/liquidity';
import AmountInput from '../../components/defi/AmountInput';
import ConfirmTxModal from '../../components/defi/ConfirmTxModal';
import InfoRow from '../../components/defi/InfoRow';
import Panel from '../../components/defi/Panel';
import { NotConfigured } from '../../components/defi/EmptyState';
import { fmtAmount, fmtUsd, toAmountString } from '../../utils/format';

interface Props {
  initialPool?: string | null;
}

export default function LiquidityTab({ initialPool }: Props) {
  const { chainId, account, chain } = useNetwork();
  const { notify } = useToast();
  const pools = usePools(chainId, account);
  const liquidity = useLiquidity(chainId, account);
  const [selected, setSelected] = useState<string>('');
  const [amount0, setAmount0] = useState('');
  const [amount1, setAmount1] = useState('');
  const [removeAmount, setRemoveAmount] = useState('');
  const [confirm, setConfirm] = useState<'add' | 'remove' | null>(null);

  useEffect(() => {
    if (initialPool) setSelected(initialPool);
  }, [initialPool]);

  useEffect(() => {
    if (!selected && pools.data?.length) setSelected(pools.data[0].address);
  }, [pools.data, selected]);

  const pool = useMemo(
    () => (pools.data ?? []).find((item) => item.address === selected) ?? null,
    [pools.data, selected],
  );

  const walletBalances = useTokenBalances(
    chainId,
    account,
    pool ? [pool.token0.address, pool.token1.address] : [],
    15_000,
  );
  const balance0 = pool ? walletBalances.data?.[pool.token0.address.toLowerCase()]?.balance ?? 0n : 0n;
  const balance1 = pool ? walletBalances.data?.[pool.token1.address.toLowerCase()]?.balance ?? 0n : 0n;

  const parsed = (value: string, decimals: number): bigint => {
    try {
      return value.trim() ? parseUnits(value, decimals) : 0n;
    } catch {
      return 0n;
    }
  };

  const amount0Wei = pool ? parsed(amount0, pool.token0.decimals) : 0n;
  const amount1Wei = pool ? parsed(amount1, pool.token1.decimals) : 0n;
  const removeWei = pool ? parsed(removeAmount, 18) : 0n;

  const expected = pool && amount0Wei > 0n ? quoteCounterpart(pool, amount0Wei) : null;
  const lpEstimate =
    pool && amount0Wei > 0n && amount1Wei > 0n && pool.lpSupply > 0n
      ? (() => {
          const from0 = (amount0Wei * pool.lpSupply) / pool.reserve0;
          const from1 = (amount1Wei * pool.lpSupply) / pool.reserve1;
          return from0 < from1 ? from0 : from1;
        })()
      : null;

  const fillRatio = () => {
    if (!pool || amount0Wei === 0n) return;
    const counterpart = quoteCounterpart(pool, amount0Wei);
    if (counterpart !== null) {
      setAmount1(toAmountString(counterpart, pool.token1.decimals));
    }
  };

  const doAdd = async () => {
    if (!pool) return;
    setConfirm(null);
    const result = await liquidity.add(pool, amount0Wei, amount1Wei);
    if (!result || !account) return;
    addTransaction({
      hash: result.tx,
      chainId,
      account,
      kind: 'liquidity',
      description: `Adicionar ${fmtAmount(amount0Wei, pool.token0.decimals, 4)} ${pool.token0.symbol} + ${fmtAmount(amount1Wei, pool.token1.decimals, 4)} ${pool.token1.symbol}`,
      to: pool.address,
      contract: pool.address,
    });
    const status = await trackTransaction(chainId, account, result.tx);
    notify(
      status === 'failed' ? 'error' : 'success',
      status === 'failed' ? 'Liquidez revertida' : 'Liquidez adicionada',
      result.tx,
    );
    pools.refresh();
    setAmount0('');
    setAmount1('');
  };

  const doRemove = async () => {
    if (!pool) return;
    setConfirm(null);
    const result = await liquidity.remove(pool, removeWei);
    if (!result || !account) return;
    addTransaction({
      hash: result.tx,
      chainId,
      account,
      kind: 'liquidity',
      description: `Remover ${fmtAmount(removeWei, 18, 4)} LP de ${pool.token0.symbol}/${pool.token1.symbol}`,
      to: pool.address,
      contract: pool.address,
    });
    const status = await trackTransaction(chainId, account, result.tx);
    notify(
      status === 'failed' ? 'error' : 'success',
      status === 'failed' ? 'Remoção revertida' : 'Liquidez removida',
      result.tx,
    );
    pools.refresh();
    setRemoveAmount('');
  };

  return (
    <div className="space-y-4">
      <Panel
        title="Liquidez"
        subtitle={`${chain.name} · KurRouter (add) e KurPair (remove)`}
        actions={
          <select
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            className="rounded-lg border border-kur-border bg-kur-bg/70 px-2 py-1 text-[10px] text-kur-text focus:border-kur-accent/60 focus:outline-none"
          >
            {(pools.data ?? []).map((item) => (
              <option key={item.address} value={item.address}>
                {item.token0.symbol}/{item.token1.symbol} · {fmtUsd(item.tvlUsd, { compact: true })}
              </option>
            ))}
          </select>
        }
      >
        {!pool ? (
          <NotConfigured what="pool com liquidez" detail="Nenhum par disponível nesta rede para gerenciar liquidez." />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3 rounded-xl border border-kur-border/70 bg-kur-bg/30 p-3">
              <p className="text-xs font-medium text-kur-text">
                Adicionar liquidez — {pool.token0.symbol}/{pool.token1.symbol}
              </p>
              <AmountInput
                label={`Quantidade ${pool.token0.symbol}`}
                value={amount0}
                onChange={setAmount0}
                symbol={pool.token0.symbol}
                decimals={pool.token0.decimals}
                balance={account ? balance0 : null}
                onMax={() => setAmount0(toAmountString(balance0, pool.token0.decimals))}
                disabled={!account}
              />
              <button
                type="button"
                onClick={fillRatio}
                disabled={amount0Wei === 0n}
                className="text-[10px] text-kur-accent disabled:opacity-40"
              >
                preencher proporção do pool
              </button>
              <AmountInput
                label={`Quantidade ${pool.token1.symbol}`}
                value={amount1}
                onChange={setAmount1}
                symbol={pool.token1.symbol}
                decimals={pool.token1.decimals}
                balance={account ? balance1 : null}
                onMax={() => setAmount1(toAmountString(balance1, pool.token1.decimals))}
                disabled={!account}
              />
              {expected !== null && (
                <p className="text-[10px] text-kur-text-muted">
                  Proporção atual pede {fmtAmount(expected, pool.token1.decimals, 4)} {pool.token1.symbol}.
                </p>
              )}
              <InfoRow label="LP estimado" value={lpEstimate ? fmtAmount(lpEstimate, 18, 4) : '—'} />
              <InfoRow label="Sua participação atual" value={pool.myShare ? `${(pool.myShare * 100).toFixed(4)}%` : '—'} />
              <button
                type="button"
                disabled={!account || amount0Wei === 0n || amount1Wei === 0n || liquidity.busy}
                onClick={() => setConfirm('add')}
                className="w-full rounded-xl bg-kur-gradient px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
              >
                {account ? 'Adicionar liquidez' : 'Conecte a carteira'}
              </button>
              <p className="text-[9px] text-kur-text-muted">
                Exige approve dos dois tokens para o KurRouter; a carteira assina cada etapa.
              </p>
            </div>

            <div className="space-y-3 rounded-xl border border-kur-border/70 bg-kur-bg/30 p-3">
              <p className="text-xs font-medium text-kur-text">Remover liquidez</p>
              <p className="text-[10px] text-kur-text-muted">
                Seu LP: {fmtAmount(pool.myLp ?? 0n, 18, 6)} ({(pool.myShare ? pool.myShare * 100 : 0).toFixed(4)}% do pool)
              </p>
              <AmountInput
                label="LP a queimar"
                value={removeAmount}
                onChange={setRemoveAmount}
                symbol="LP"
                decimals={18}
                balance={pool.myLp ?? 0n}
                onMax={() => setRemoveAmount(toAmountString(pool.myLp ?? 0n, 18))}
                disabled={!account || (pool.myLp ?? 0n) === 0n}
              />
              {removeWei > 0n && pool.lpSupply > 0n && (
                <div className="space-y-1 rounded-lg bg-kur-bg/50 p-2 text-[10px]">
                  <p className="text-kur-text-muted">Você recebe (estimado)</p>
                  <p className="font-mono text-kur-green">
                    {fmtAmount((pool.reserve0 * removeWei) / pool.lpSupply, pool.token0.decimals, 6)} {pool.token0.symbol}
                  </p>
                  <p className="font-mono text-kur-green">
                    {fmtAmount((pool.reserve1 * removeWei) / pool.lpSupply, pool.token1.decimals, 6)} {pool.token1.symbol}
                  </p>
                </div>
              )}
              <button
                type="button"
                disabled={!account || removeWei === 0n || liquidity.busy}
                onClick={() => setConfirm('remove')}
                className="w-full rounded-xl border border-kur-red/30 bg-kur-red/10 px-4 py-2 text-xs font-semibold text-kur-red disabled:opacity-40"
              >
                Remover liquidez
              </button>
              <p className="text-[9px] text-kur-text-muted">
                Duas transações: transferir o LP para o par e chamar <code>burn</code> (padrão Uniswap V2).
              </p>
            </div>
          </div>
        )}

        {liquidity.error && (
          <p className="mt-3 rounded-lg border border-kur-red/30 bg-kur-red/5 px-2 py-1 text-[11px] text-kur-red">
            {liquidity.error}
          </p>
        )}
      </Panel>

      {pool && (
        <ConfirmTxModal
          open={confirm !== null}
          title={confirm === 'add' ? 'Confirmar liquidez' : 'Confirmar remoção'}
          amountText={
            confirm === 'add'
              ? `${fmtAmount(amount0Wei, pool.token0.decimals, 6)} ${pool.token0.symbol} + ${fmtAmount(amount1Wei, pool.token1.decimals, 6)} ${pool.token1.symbol}`
              : `${fmtAmount(removeWei, 18, 6)} LP`
          }
          contractLabel={confirm === 'add' ? 'KurRouter' : 'KurPair'}
          contractAddress={pool.address}
          chainId={chainId}
          busy={liquidity.busy}
          details={
            confirm === 'add'
              ? [
                  { label: 'Pool', value: `${pool.token0.symbol}/${pool.token1.symbol}` },
                  { label: 'LP estimado', value: lpEstimate ? fmtAmount(lpEstimate, 18, 4) : '—' },
                ]
              : [
                  { label: 'Pool', value: `${pool.token0.symbol}/${pool.token1.symbol}` },
                  { label: 'Participação', value: pool.myShare ? `${(pool.myShare * 100).toFixed(4)}%` : '—' },
                ]
          }
          onConfirm={() => void (confirm === 'add' ? doAdd() : doRemove())}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
