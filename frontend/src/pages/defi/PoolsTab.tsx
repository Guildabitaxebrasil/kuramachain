import { useEffect, useMemo, useState } from 'react';
import type { PoolInfo } from '../../types/defi';
import { useNetwork } from '../../context/NetworkContext';
import { usePools } from '../../hooks/usePools';
import { useAnalytics } from '../../hooks/useAnalytics';
import { useAsync } from '../../hooks/useAsync';
import { loadPairTrades } from '../../services/pools';
import Panel from '../../components/defi/Panel';
import PoolsTable from '../../components/defi/PoolsTable';
import CandleChart from '../../components/defi/CandleChart';
import InfoRow from '../../components/defi/InfoRow';
import { NotConfigured } from '../../components/defi/EmptyState';
import { fmtAmount, fmtPrice, fmtUsd, shortAddress } from '../../utils/format';
import { poolPrice } from '../../services/pools';

interface Props {
  onAddLiquidity: (poolAddress: string) => void;
}

export default function PoolsTab({ onAddLiquidity }: Props) {
  const { chainId, account, chain } = useNetwork();
  const pools = usePools(chainId, account);
  const analytics = useAnalytics(chainId, pools.data ?? []);
  const [selected, setSelected] = useState<string | null>(null);

  const pool: PoolInfo | null = useMemo(() => {
    const list = pools.data ?? [];
    return list.find((item) => item.address === selected) ?? list[0] ?? null;
  }, [pools.data, selected]);

  useEffect(() => {
    if (!selected && pools.data?.length) setSelected(pools.data[0].address);
  }, [pools.data, selected]);

  const trades = useAsync(
    () => (pool ? loadPairTrades(chainId, pool, { hours: 24 * 7 }) : Promise.resolve([])),
    [chainId, pool?.address],
    { pollMs: 45_000, enabled: !!pool },
  );

  const volumes = Object.fromEntries(
    (analytics.data?.perPool ?? []).map((item) => [item.pool.address.toLowerCase(), item.volume24hUsd]),
  );

  const price0In1 = pool ? poolPrice(pool, 'token0') : null;

  return (
    <div className="space-y-4">
      <Panel
        title="Pools"
        subtitle={`${chain.name} · ${pools.data?.length ?? 0} pool(s)`}
        actions={
          <button
            type="button"
            onClick={() => pool && onAddLiquidity(pool.address)}
            disabled={!pool || pool.dex !== 'kur'}
            className="rounded-lg border border-kur-accent/30 bg-kur-accent/10 px-2 py-1 text-[10px] text-kur-accent disabled:opacity-40"
          >
            Adicionar liquidez
          </button>
        }
      >
        {pools.error ? (
          <NotConfigured what="KurFactory" detail={pools.error} />
        ) : (
          <PoolsTable
            pools={pools.data ?? []}
            selected={pool?.address}
            onSelect={(next) => setSelected(next.address)}
            volumes={volumes}
            showMine
          />
        )}
      </Panel>

      {pool && (
        <div className="grid gap-4 lg:grid-cols-[1.4fr_0.6fr]">
          <Panel
            title={`${pool.token0.symbol}/${pool.token1.symbol}`}
            subtitle={
              pool.dex === 'kur'
                ? `KurPair · ${shortAddress(pool.address, 6)} · taxa 0,30%`
                : `Uniswap V3 · ${(pool.fee * 100).toFixed(2)}% · ${shortAddress(pool.address, 6)}`
            }
            actions={
              <a
                href="#"
                onClick={(event) => {
                  event.preventDefault();
                  onAddLiquidity(pool.address);
                }}
                className="text-[10px] text-kur-accent hover:underline"
              >
                gerenciar liquidez
              </a>
            }
          >
            {trades.data && trades.data.length > 0 ? (
              <CandleChart
                trades={trades.data}
                pairLabel={`${pool.token1.symbol} por ${pool.token0.symbol}`}
                height={300}
              />
            ) : (
              <div className="py-10 text-center text-[11px] text-kur-text-muted">
                Sem eventos <span className="font-mono">Swap</span> na janela de 7 dias — nada para desenhar.
              </div>
            )}
          </Panel>

          <div className="space-y-4">
            <Panel title="Reservas e liquidez" subtitle="Leitura direta do contrato">
              <InfoRow label={`Reserva ${pool.token0.symbol}`} value={fmtAmount(pool.reserve0, pool.token0.decimals, 4)} mono />
              <InfoRow label={`Reserva ${pool.token1.symbol}`} value={fmtAmount(pool.reserve1, pool.token1.decimals, 4)} mono />
              <InfoRow label="TVL" value={fmtUsd(pool.tvlUsd)} />
              <InfoRow
                label="Preço implícito"
                value={price0In1 ? `1 ${pool.token0.symbol} = ${fmtPrice(price0In1).replace('$', '')} ${pool.token1.symbol}` : '—'}
              />
              <InfoRow
                label="Preço USD"
                value={`${pool.price0Usd ? fmtPrice(pool.price0Usd) : '—'} / ${pool.price1Usd ? fmtPrice(pool.price1Usd) : '—'}`}
              />
              <InfoRow label="LP supply" value={fmtAmount(pool.lpSupply, 18, 2)} mono />
              <InfoRow
                label="Minha participação"
                value={pool.myShare ? `${(pool.myShare * 100).toFixed(4)}%` : '—'}
                tone={pool.myShare ? 'positive' : 'muted'}
              />
              <InfoRow
                label="Volume 24h"
                value={fmtUsd(volumes[pool.address.toLowerCase()] ?? null)}
              />
              <InfoRow label="Trades 24h" value={analytics.data?.perPool.find((item) => item.pool.address === pool.address)?.trades24h ?? '—'} />
            </Panel>

            <Panel title="Risco do pool" subtitle="Sem score inventado">
              <ul className="space-y-1.5 text-[10px] text-kur-text-muted">
                <li>• TVL: {fmtUsd(pool.tvlUsd)} {pool.tvlUsd !== null && pool.tvlUsd < 100 ? '(muito baixa)' : ''}</li>
                <li>• Preço on-chain: {pool.price0Usd && pool.price1Usd ? 'disponível' : 'indisponível'}</li>
                <li>• DEX: {pool.dex === 'kur' ? 'AMM próprio (x*y=k)' : 'Uniswap V3 (liquidez concentrada)'}</li>
                <li>• Slippage cresce rápido com reservas baixas — simule antes de trocar.</li>
              </ul>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
