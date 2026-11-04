import { useNetwork } from '../../context/NetworkContext';
import { usePools } from '../../hooks/usePools';
import { useAnalytics } from '../../hooks/useAnalytics';
import { useAsync } from '../../hooks/useAsync';
import { getBlockNumber } from '../../services/rpc';
import EvmWalletCard from '../../components/EvmWalletCard';
import PriceChart from '../../components/defi/PriceChart';
import Panel from '../../components/defi/Panel';
import StatTile from '../../components/defi/StatTile';
import ContractSettings from '../../components/defi/ContractSettings';
import PoolsTable from '../../components/defi/PoolsTable';
import { NotConfigured } from '../../components/defi/EmptyState';
import { fmtPct, fmtUsd } from '../../utils/format';
import { KURAMA_CHAIN_ID } from '../../chains/chains';

export default function DashboardTab() {
  const { chainId, chain, account, tokens } = useNetwork();
  const pools = usePools(chainId, account);
  const analytics = useAnalytics(chainId, pools.data ?? []);
  const block = useAsync(() => getBlockNumber(chainId), [chainId], { pollMs: 15_000 });

  const summary = analytics.data;
  const tvlHistory = summary?.tvlHistory ?? [];
  const volumeHistory = summary?.volumeHistory ?? [];
  const tvlDelta = (() => {
    if (tvlHistory.length < 2) return null;
    const first = tvlHistory[0].v;
    const last = tvlHistory[tvlHistory.length - 1].v;
    return first > 0 ? ((last - first) / first) * 100 : null;
  })();
  const priceable = (pools.data ?? []).filter((pool) => pool.tvlUsd !== null).length;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="TVL total"
          value={fmtUsd(summary?.tvlUsd ?? null, { compact: true })}
          delta={tvlDelta}
          deltaLabel="no histórico"
          hint={`${priceable} pool(s) com preço on-chain`}
          icon="💧"
          tone="accent"
        />
        <StatTile
          label="Volume 24h"
          value={fmtUsd(summary?.volume24hUsd ?? null, { compact: true })}
          hint={summary?.truncated ? 'mínimo (limite de logs)' : 'eventos Swap on-chain'}
          icon="🔁"
          tone="green"
        />
        <StatTile
          label="Volume 7d"
          value={fmtUsd(summary?.volume7dUsd ?? null, { compact: true })}
          hint="janela de 7 dias"
          icon="📅"
          tone="violet"
        />
        <StatTile
          label="Taxas 24h (0,3%)"
          value={fmtUsd(summary?.fees24hUsd ?? null, { compact: true })}
          hint="estimativa sobre o volume real"
          icon="💰"
          tone="yellow"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Pools ativos" value={summary?.pools ?? pools.data?.length ?? 0} hint={chain.name} icon="🧩" />
        <StatTile label="Tokens listados" value={tokens.length} hint="nativos + verificados + custom" icon="🪙" />
        <StatTile label="Trades 24h" value={summary?.trades24h ?? 0} hint="logs do AMM" icon="⚡" tone="accent" />
        <StatTile
          label="Bloco atual"
          value={block.data ?? '—'}
          hint={`RPC ${chain.id}`}
          icon="🧱"
          tone="muted"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="TVL" subtitle="Série construída com snapshots reais de reservas × preço">
          <PriceChart id="tvl" data={tvlHistory} format="usd" color="#58a6ff" height={220} />
        </Panel>
        <Panel title="Volume 24h" subtitle="Somatório dos eventos Swap por janela">
          <PriceChart id="volume" data={volumeHistory} format="usd" color="#a855f7" height={220} />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <Panel
          title="Top pools por liquidez"
          subtitle="Reservas lidas do contrato, preço do oráculo/par"
        >
          {pools.error ? (
            <NotConfigured what="KurFactory" detail={pools.error} />
          ) : (
            <PoolsTable pools={(pools.data ?? []).slice(0, 6)} volumes={
              Object.fromEntries(
                (summary?.perPool ?? []).map((item) => [item.pool.address.toLowerCase(), item.volume24hUsd]),
              )
            } />
          )}
        </Panel>

        <div className="space-y-4">
          {chainId === KURAMA_CHAIN_ID && <EvmWalletCard />}
          <Panel title="Estado do protocolo" subtitle="O que é real hoje">
            <ul className="space-y-2 text-[11px] text-kur-text-muted">
              <li>
                <span className="text-kur-text">Swap/DEX</span> — KurFactory + KurPair + KurRouter, taxa de
                0,3% por salto.
              </li>
              <li>
                <span className="text-kur-text">Preço</span> — KurPriceFeed (mediana com quórum) com fallback
                para o par do AMM.
              </li>
              <li>
                <span className="text-kur-text">Histórico</span> — começa na primeira leitura desta interface;
                sem histórico, os gráficos avisam.
              </li>
              <li>
                <span className="text-kur-text">Multi-chain</span> — leitura de pools Uniswap V3 nas redes com
                factory configurada; swap executável na 9090 e na Polygon.
              </li>
            </ul>
            {analytics.error && (
              <p className="mt-2 rounded-lg border border-kur-yellow/30 bg-kur-yellow/5 px-2 py-1 text-[10px] text-kur-yellow">
                Analytics: {analytics.error}
              </p>
            )}
          </Panel>
        </div>
      </div>

      <ContractSettings />
    </div>
  );
}
