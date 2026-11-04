import { useMemo, useState } from 'react';
import { useNetwork } from '../../context/NetworkContext';
import { useAsync } from '../../hooks/useAsync';
import { loadHoldings } from '../../services/portfolio';
import PriceChart from '../../components/defi/PriceChart';
import Panel from '../../components/defi/Panel';
import TokensTable from '../../components/defi/TokensTable';
import EmptyState, { DataUnavailable } from '../../components/defi/EmptyState';
import Sparkline from '../../components/defi/Sparkline';
import { loadTokenPriceHistory } from '../../services/analytics';
import { useTokenPrice } from '../../hooks/useTokenPrice';
import { fmtPct, fmtPrice, fmtUsd, shortAddress } from '../../utils/format';
import { explorerAddressUrl } from '../../chains/chains';

export default function MarketsTab() {
  const { chainId, chain, account, tokens } = useNetwork();
  const holdings = useAsync(
    () => (account ? loadHoldings(chainId, account) : Promise.resolve([])),
    [chainId, account],
    { pollMs: 30_000 },
  );
  const [selected, setSelected] = useState<string>(tokens[0]?.address ?? '');
  const price = useTokenPrice(chainId, selected || undefined);
  const history = useMemo(
    () => (selected ? loadTokenPriceHistory(chainId, selected) : []),
    [chainId, selected],
  );
  const token = tokens.find((item) => item.address.toLowerCase() === selected.toLowerCase());

  return (
    <div className="space-y-4">
      <Panel
        title="Markets"
        subtitle={`${chain.name} · preço on-chain (sem API externa)`}
        actions={
          <span className="text-[10px] text-kur-text-muted">
            {holdings.data?.length ?? tokens.length} token(s)
          </span>
        }
      >
        {holdings.loading ? (
          <p className="py-6 text-center text-xs text-kur-text-muted">Lendo saldos e preços…</p>
        ) : (
          <TokensTable
            chainId={chainId}
            holdings={holdings.data ?? []}
            account={account}
            onSelect={setSelected}
          />
        )}
        {holdings.error && <p className="mt-2 text-[11px] text-kur-red">{holdings.error}</p>}
        {!account && (
          <p className="mt-2 text-[10px] text-kur-text-muted">
            Conecte a carteira para ver saldo e valor em USD por token.
          </p>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Panel
          title={token ? `${token.symbol} — preço` : 'Preço do token'}
          subtitle={token ? `${token.name} · ${shortAddress(token.address, 6)}` : 'Selecione um token na tabela'}
        >
          <PriceChart id="market-price" data={history} format="price" color="#22d3ee" height={240} />
        </Panel>

        <Panel title="Detalhes" subtitle="Fonte e identificação">
          {token ? (
            <div className="space-y-2 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-kur-text-muted">Preço</span>
                <span className="font-mono text-kur-text">{fmtPrice(price.data?.usd ?? null)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-kur-text-muted">Fonte</span>
                <span className="text-right text-[10px] text-kur-text">{price.data?.source ?? '—'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-kur-text-muted">Atualizado</span>
                <span className="font-mono text-[10px] text-kur-text">
                  {price.data?.updatedAt ? new Date(price.data.updatedAt * 1000).toLocaleString('pt-BR') : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-kur-text-muted">Série observada</span>
                <Sparkline data={history} width={100} height={24} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-kur-text-muted">Saldo</span>
                <span className="font-mono text-[10px] text-kur-text">
                  {(() => {
                    const entry = holdings.data?.find(
                      (item) => item.token.address.toLowerCase() === token.address.toLowerCase(),
                    );
                    return entry ? `${entry.balance.toString()} (wei)` : '—';
                  })()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-kur-text-muted">Valor</span>
                <span className="font-mono text-kur-text">
                  {fmtUsd(
                    holdings.data?.find(
                      (item) => item.token.address.toLowerCase() === token.address.toLowerCase(),
                    )?.valueUsd ?? null,
                  )}
                </span>
              </div>
              <a
                href={explorerAddressUrl(chainId, token.address)}
                target="_blank"
                rel="noreferrer"
                className="block break-all font-mono text-[10px] text-kur-accent hover:underline"
              >
                {token.address}
              </a>
              {!token.verified && (
                <p className="rounded-lg border border-kur-yellow/30 bg-kur-yellow/5 px-2 py-1 text-[10px] text-kur-yellow">
                  Token customizado: endereço não verificado pelo projeto.
                </p>
              )}
            </div>
          ) : (
            <EmptyState compact icon="🪙" title="Nenhum token selecionado" />
          )}
          {price.data?.usd === null && <div className="mt-2"><DataUnavailable detail="sem par com ativo precificado nesta rede" /></div>}
          <p className="mt-3 text-[10px] text-kur-text-muted">
            Variações 1h/24h/7d usam o histórico observado por esta interface. Sem histórico, aparece “—”.
          </p>
        </Panel>
      </div>
    </div>
  );
}
