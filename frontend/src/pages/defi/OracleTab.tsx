import { useNetwork } from '../../context/NetworkContext';
import { useOracle } from '../../hooks/useOracle';
import Panel from '../../components/defi/Panel';
import InfoRow from '../../components/defi/InfoRow';
import EmptyState, { DataUnavailable, NotConfigured } from '../../components/defi/EmptyState';
import { fmtDateTime, fmtPrice, timeAgo } from '../../utils/format';

export default function OracleTab() {
  const { chainId, chain, contracts } = useNetwork();
  const oracle = useOracle(chainId);
  const data = oracle.data;

  return (
    <div className="space-y-4">
      <Panel
        title="Oráculo / Market data"
        subtitle={`${chain.name} · KurPriceFeed (AggregatorV3) + KurOracle (TWAP)`}
        actions={<span className="text-[10px] text-kur-text-muted">atualiza a cada 30s</span>}
      >
        {oracle.error ? (
          <NotConfigured what="KurPriceFeed / KurOracle" detail={oracle.error} />
        ) : !data?.configured ? (
          <NotConfigured
            what="KurPriceFeed / KurOracle"
            detail={data?.notes[0] ?? 'Nenhum oráculo configurado para esta rede.'}
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
            <div className="space-y-2">
              {data.readings.length ? (
                data.readings.map((reading) => (
                  <div key={reading.label} className="rounded-xl border border-kur-border/70 bg-kur-bg/30 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-[11px] font-medium text-kur-text">{reading.label}</p>
                        <p className="text-[10px] text-kur-text-muted">{reading.source}</p>
                      </div>
                      <span
                        className={`rounded-full border px-1.5 py-0.5 text-[9px] ${
                          reading.fresh === true
                            ? 'border-kur-green/30 bg-kur-green/10 text-kur-green'
                            : reading.fresh === false
                              ? 'border-kur-yellow/30 bg-kur-yellow/10 text-kur-yellow'
                              : 'border-kur-border text-kur-text-muted'
                        }`}
                      >
                        {reading.fresh === true ? 'fresco' : reading.fresh === false ? 'obsoleto' : 'sem status'}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-base text-kur-accent">
                      {reading.price === null ? 'Dados indisponíveis' : fmtPrice(reading.price)}
                    </p>
                    <p className="text-[10px] text-kur-text-muted">
                      {reading.decimals !== null && `${reading.decimals} decimais`}
                      {reading.updatedAt ? ` · ${fmtDateTime(reading.updatedAt)} (${timeAgo(reading.updatedAt)})` : ''}
                      {reading.extra ? ` · ${reading.extra}` : ''}
                    </p>
                  </div>
                ))
              ) : (
                <DataUnavailable detail="o contrato não devolveu leitura válida" />
              )}
              {data.notes.map((note) => (
                <p key={note} className="rounded-lg border border-kur-yellow/30 bg-kur-yellow/5 px-2 py-1 text-[10px] text-kur-yellow">
                  {note}
                </p>
              ))}
            </div>

            <div className="space-y-3">
              <div className="rounded-xl border border-kur-border/70 bg-kur-bg/30 p-3">
                <p className="mb-1 text-[10px] uppercase tracking-wider text-kur-text-muted">Configuração</p>
                <InfoRow label="KurPriceFeed" value={data.feedConfigured ? 'configurado' : 'não configurado'} tone={data.feedConfigured ? 'positive' : 'warning'} />
                <InfoRow label="KurOracle" value={data.oracleConfigured ? 'configurado' : 'não configurado'} tone={data.oracleConfigured ? 'positive' : 'warning'} />
                <InfoRow label="Descrição do feed" value={data.description ?? '—'} />
                <InfoRow label="Quórum" value={data.quorum ?? '—'} />
                <InfoRow label="Reporters" value={data.reporters ?? '—'} />
                <InfoRow label="maxAge" value={data.maxAge !== null ? `${data.maxAge}s` : '—'} />
                <InfoRow label="Período da TWAP" value={data.period !== null ? `${data.period}s` : '—'} />
                <InfoRow label="TWAP pronta" value={data.twapReady === null ? '—' : data.twapReady ? 'sim' : 'não'} tone={data.twapReady ? 'positive' : 'warning'} />
              </div>
              <p className="text-[10px] leading-relaxed text-kur-text-muted">
                O preço em USD dos tokens também usa o feed: a rota é <code>KurPriceFeed → par do AMM</code>.
                Sem feed e sem par com ativo precificado, a UI mostra “Dados indisponíveis”.
              </p>
              <p className="text-[10px] text-kur-text-muted">
                Feed: <span className="font-mono">{contracts.priceFeed.address || '—'}</span>
                <br />
                TWAP: <span className="font-mono">{contracts.oracle.address || '—'}</span>
              </p>
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Como o preço é formado" subtitle="Sem mágica">
        <EmptyState
          compact
          icon="🔮"
          title="Feed com quórum + fallback TWAP"
          description="Reporters autorizados enviam o preço; a rodada fecha na mediana quando o quórum é atingido. Se o feed ficar obsoleto, o KurOracle cai na TWAP do par — a UI marca a fonte de cada leitura."
        />
      </Panel>
    </div>
  );
}
