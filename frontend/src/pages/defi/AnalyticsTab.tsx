import { useNetwork } from '../../context/NetworkContext';
import { usePools } from '../../hooks/usePools';
import { useAnalytics } from '../../hooks/useAnalytics';
import Panel from '../../components/defi/Panel';
import PriceChart from '../../components/defi/PriceChart';
import StatTile from '../../components/defi/StatTile';
import { NotConfigured } from '../../components/defi/EmptyState';
import { fmtUsd } from '../../utils/format';

export default function AnalyticsTab() {
  const { chainId, account, chain } = useNetwork();
  const pools = usePools(chainId, account);
  const analytics = useAnalytics(chainId, pools.data ?? []);
  const data = analytics.data;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="TVL" value={fmtUsd(data?.tvlUsd ?? null, { compact: true })} hint={`${data?.pricedPools ?? 0} pool(s) precificado(s)`} tone="accent" icon="💧" />
        <StatTile label="Volume 24h" value={fmtUsd(data?.volume24hUsd ?? null, { compact: true })} hint={`${data?.trades24h ?? 0} trades`} tone="green" icon="🔁" />
        <StatTile label="Volume 7d" value={fmtUsd(data?.volume7dUsd ?? null, { compact: true })} hint={data?.truncated ? 'mínimo (limite de 400 logs)' : 'janela de 7 dias'} tone="violet" icon="📅" />
        <StatTile label="Taxas 24h" value={fmtUsd(data?.fees24hUsd ?? null, { compact: true })} hint="0,3% do volume" tone="yellow" icon="💰" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="TVL" subtitle={`${chain.name} · snapshots reais`}>
          <PriceChart id="analytics-tvl" data={data?.tvlHistory ?? []} format="usd" height={240} />
        </Panel>
        <Panel title="Volume 24h" subtitle="Somatório dos eventos Swap">
          <PriceChart id="analytics-volume" data={data?.volumeHistory ?? []} format="usd" color="#a855f7" height={240} />
        </Panel>
      </div>

      <Panel title="Volume por pool" subtitle="24h e 7d por par (eventos Swap)">
        {analytics.error ? (
          <NotConfigured what="pools" detail={analytics.error} />
        ) : (data?.perPool.length ?? 0) === 0 ? (
          <p className="py-6 text-center text-[11px] text-kur-text-muted">
            Nenhum pool com preço on-chain — sem USD não há volume em USD.
          </p>
        ) : (
          <div className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-kur-text-muted">
                  <th className="px-2 py-2 font-medium">Pool</th>
                  <th className="px-2 py-2 font-medium">TVL</th>
                  <th className="px-2 py-2 font-medium">Volume 24h</th>
                  <th className="px-2 py-2 font-medium">Volume 7d</th>
                  <th className="px-2 py-2 font-medium">Trades 24h</th>
                  <th className="px-2 py-2 font-medium">Taxas 24h</th>
                </tr>
              </thead>
              <tbody>
                {data?.perPool.map((item) => (
                  <tr key={item.pool.address} className="border-t border-kur-border/60">
                    <td className="px-2 py-2 text-kur-text">
                      {item.pool.token0.symbol}/{item.pool.token1.symbol}
                    </td>
                    <td className="px-2 py-2 font-mono text-[10px] text-kur-text-muted">{fmtUsd(item.pool.tvlUsd)}</td>
                    <td className="px-2 py-2 font-mono text-[10px] text-kur-text">{fmtUsd(item.volume24hUsd)}</td>
                    <td className="px-2 py-2 font-mono text-[10px] text-kur-text-muted">{fmtUsd(item.volume7dUsd)}</td>
                    <td className="px-2 py-2 font-mono text-[10px] text-kur-text-muted">{item.trades24h}</td>
                    <td className="px-2 py-2 font-mono text-[10px] text-kur-text-muted">
                      {fmtUsd(item.volume24hUsd === null ? null : item.volume24hUsd * 0.003)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[10px] text-kur-text-muted">
          Volume usa apenas trades com preço disponível; quando o teto de 400 logs é atingido, o número é um
          mínimo (marcado como tal). Não há extrapolação.
        </p>
      </Panel>
    </div>
  );
}
