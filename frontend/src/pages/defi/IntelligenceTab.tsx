import { useMemo } from 'react';
import { useNetwork } from '../../context/NetworkContext';
import { usePools } from '../../hooks/usePools';
import { useAnalytics } from '../../hooks/useAnalytics';
import { buildIntelligence } from '../../services/intelligence';
import Panel from '../../components/defi/Panel';
import EmptyState, { NotConfigured } from '../../components/defi/EmptyState';
import { fmtPct, fmtPrice, fmtUsd } from '../../utils/format';

const TONE: Record<string, string> = {
  positive: 'border-kur-green/30 bg-kur-green/5 text-kur-green',
  negative: 'border-kur-red/30 bg-kur-red/5 text-kur-red',
  warning: 'border-kur-yellow/30 bg-kur-yellow/5 text-kur-yellow',
  neutral: 'border-kur-border bg-kur-bg/30 text-kur-text',
};

export default function IntelligenceTab() {
  const { chainId, account, chain } = useNetwork();
  const pools = usePools(chainId, account);
  const analytics = useAnalytics(chainId, pools.data ?? []);
  const report = useMemo(
    () => buildIntelligence(pools.data ?? [], analytics.data),
    [pools.data, analytics.data],
  );

  return (
    <div className="space-y-4">
      <Panel
        title="Kurama Intelligence"
        subtitle={`${chain.name} · insights derivados dos dados on-chain, sem achismo`}
      >
        {pools.error ? (
          <NotConfigured what="KurFactory" detail={pools.error} />
        ) : (pools.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon="🧠"
            title="Sem dados suficientes"
            description="É preciso ao menos um pool com liquidez e preço on-chain para gerar insights."
          />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {report.insights.length ? (
              report.insights.map((insight) => (
                <div key={insight.id} className={`rounded-xl border p-3 ${TONE[insight.tone]}`}>
                  <p className="text-[11px] font-semibold">{insight.title}</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-kur-text-muted">{insight.detail}</p>
                </div>
              ))
            ) : (
              <p className="text-[11px] text-kur-text-muted">
                Nenhum insight ainda — falta histórico de preço/TVL ou volume.
              </p>
            )}
          </div>
        )}
        <p className="mt-2 text-[10px] text-kur-text-muted">
          Cálculos: liquidez e preço médio vêm das reservas; variações vêm de snapshots locais; oportunidades
          triangulares comparam rota direta e indireta <em>sem</em> descontar gas/slippage — trate como
          sinal, não como lucro.
        </p>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Assimetrias entre rotas" subtitle="Direta vs 2 saltos no mesmo factory">
          {report.triangles.length ? (
            <div className="space-y-2">
              {report.triangles.map((triangle) => (
                <div key={triangle.tokens.join('-')} className="rounded-xl border border-kur-border/70 bg-kur-bg/30 p-2.5 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-kur-text">{triangle.tokens.join(' → ')}</span>
                    <span className={`font-mono ${triangle.gapPct >= 0 ? 'text-kur-green' : 'text-kur-red'}`}>
                      {fmtPct(triangle.gapPct)}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] text-kur-text-muted">
                    direto {triangle.directRate.toPrecision(6)} · indireto {triangle.indirectRate.toPrecision(6)}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact icon="🔍" title="Nenhuma assimetria acima de 0,5%" description="Rotas diretas e indiretas estão alinhadas nas reservas atuais." />
          )}
        </Panel>

        <Panel title="Tokens em movimento" subtitle="Variação observada por esta interface">
          {report.tokenMoves.length ? (
            <div className="space-y-1 text-[11px]">
              {report.tokenMoves.map((move) => (
                <div key={move.address} className="flex items-center justify-between gap-2">
                  <span className="text-kur-text">{move.symbol}</span>
                  <span className="font-mono text-[10px] text-kur-text-muted">{fmtPrice(move.priceUsd)}</span>
                  <span className="font-mono text-[10px]">
                    <span className={move.change1h === null ? 'text-kur-text-muted' : move.change1h >= 0 ? 'text-kur-green' : 'text-kur-red'}>
                      1h {fmtPct(move.change1h, 1)}
                    </span>{' '}
                    <span className={move.change24h === null ? 'text-kur-text-muted' : move.change24h >= 0 ? 'text-kur-green' : 'text-kur-red'}>
                      24h {fmtPct(move.change24h, 1)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact icon="📈" title="Histórico insuficiente" description="Os tokens aparecem quando houver pelo menos duas leituras de preço." />
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Onde está a liquidez" subtitle="Top pools por TVL">
          {report.topLiquidity.length ? (
            <div className="space-y-1 text-[11px]">
              {report.topLiquidity.map((pool) => (
                <div key={pool.address} className="flex items-center justify-between">
                  <span className="text-kur-text">
                    {pool.token0.symbol}/{pool.token1.symbol}
                  </span>
                  <span className="font-mono text-[10px] text-kur-text-muted">{fmtUsd(pool.tvlUsd)}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact icon="💧" title="Sem TVL precificada" />
          )}
        </Panel>

        <Panel title="Onde está o volume" subtitle="Top pools por volume 24h">
          {report.topVolume.length ? (
            <div className="space-y-1 text-[11px]">
              {report.topVolume.map((item) => (
                <div key={item.pool.address} className="flex items-center justify-between">
                  <span className="text-kur-text">
                    {item.pool.token0.symbol}/{item.pool.token1.symbol}
                  </span>
                  <span className="font-mono text-[10px] text-kur-text-muted">{fmtUsd(item.volumeUsd)}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact icon="🔁" title="Sem trades na janela" />
          )}
        </Panel>
      </div>

      <Panel title="Riscos observados" subtitle="Só o que os dados mostram">
        {report.risks.length ? (
          <div className="space-y-2">
            {report.risks.slice(0, 8).map((risk) => (
              <div key={risk.id} className={`rounded-xl border p-2.5 ${TONE[risk.tone]}`}>
                <p className="text-[11px] font-medium">{risk.title}</p>
                <p className="mt-0.5 text-[10px] text-kur-text-muted">{risk.detail}</p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState compact icon="✅" title="Nenhum risco estrutural detectado" description="TVL, preço e reservas estão dentro dos critérios observados." />
        )}
      </Panel>
    </div>
  );
}
