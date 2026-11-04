import { useEffect, useMemo, useState } from 'react';
import type { PoolInfo } from '../../types/defi';
import { useNetwork } from '../../context/NetworkContext';
import { usePools } from '../../hooks/usePools';
import { useAsync } from '../../hooks/useAsync';
import { loadPairTrades } from '../../services/pools';
import { useTransactions } from '../../hooks/useTransactions';
import CandleChart from '../../components/defi/CandleChart';
import PoolsTable from '../../components/defi/PoolsTable';
import Panel from '../../components/defi/Panel';
import SwapPanel from '../../components/defi/SwapPanel';
import TxTable from '../../components/defi/TxTable';
import EmptyState from '../../components/defi/EmptyState';
import { fmtAmount, fmtPrice, fmtUsd, shortHash } from '../../utils/format';
import { explorerTxUrl } from '../../chains/chains';

type BottomTab = 'trades' | 'pools' | 'transactions' | 'events' | 'orders';

const BOTTOM: Array<{ id: BottomTab; label: string }> = [
  { id: 'trades', label: 'Trades' },
  { id: 'pools', label: 'Liquidez' },
  { id: 'transactions', label: 'Transações' },
  { id: 'events', label: 'Eventos' },
  { id: 'orders', label: 'Ordens' },
];

export default function TerminalTab() {
  const { chainId, account, chain } = useNetwork();
  const pools = usePools(chainId, account);
  const transactions = useTransactions(chainId, account, 'all');
  const [selected, setSelected] = useState<string | null>(null);
  const [bottom, setBottom] = useState<BottomTab>('trades');

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

  return (
    <div className="space-y-4">
      <div className="grid gap-3 xl:grid-cols-[minmax(200px,240px)_minmax(0,1fr)_minmax(320px,380px)]">
        <Panel title="Mercados" subtitle={`${chain.name}`} dense bodyClassName="p-2">
          <div className="max-h-[520px] space-y-1 overflow-y-auto">
            {(pools.data ?? []).map((item) => {
              const active = pool?.address === item.address;
              return (
                <button
                  key={item.address}
                  type="button"
                  onClick={() => setSelected(item.address)}
                  className={`w-full rounded-lg px-2 py-1.5 text-left transition-colors ${
                    active ? 'bg-kur-accent/10 text-kur-accent' : 'text-kur-text hover:bg-kur-bg-hover'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-medium">
                      {item.token0.symbol}/{item.token1.symbol}
                    </span>
                    <span className="font-mono text-[9px] text-kur-text-muted">
                      {fmtUsd(item.tvlUsd, { compact: true })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[9px] text-kur-text-muted">
                    <span>{item.dex === 'kur' ? 'KurFactory' : 'Uniswap V3'}</span>
                    <span className="font-mono">{item.price0Usd ? fmtPrice(item.price0Usd) : '—'}</span>
                  </div>
                </button>
              );
            })}
            {(pools.data?.length ?? 0) === 0 && (
              <p className="px-2 py-4 text-center text-[10px] text-kur-text-muted">Nenhum mercado</p>
            )}
          </div>
        </Panel>

        <Panel
          title={pool ? `${pool.token0.symbol}/${pool.token1.symbol}` : 'Gráfico'}
          subtitle={pool ? `${pool.dex === 'kur' ? 'KurFactory' : 'Uniswap V3'} · ${pool.address.slice(0, 10)}…` : 'Selecione um mercado'}
          actions={<span className="text-[10px] text-kur-text-muted">candles dos eventos Swap</span>}
        >
          {pool && trades.data && trades.data.length > 0 ? (
            <CandleChart trades={trades.data} height={340} pairLabel={`${pool.token1.symbol} por ${pool.token0.symbol}`} />
          ) : (
            <div className="flex h-[340px] items-center justify-center">
              <EmptyState
                compact
                icon="🕯️"
                title={trades.loading ? 'Carregando trades…' : 'Sem trades na janela'}
                description="O gráfico usa exclusivamente eventos Swap do par."
              />
            </div>
          )}
        </Panel>

        <div className="min-w-0">
          <SwapPanel compact />
        </div>
      </div>

      <Panel
        title="Atividade"
        subtitle="Dados on-chain e histórico local"
        dense
        bodyClassName="p-0"
      >
        <div className="flex gap-1 overflow-x-auto border-b border-kur-border/70 px-2 py-1.5">
          {BOTTOM.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setBottom(item.id)}
              className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-[10px] transition-colors ${
                bottom === item.id ? 'bg-kur-accent/15 text-kur-accent' : 'text-kur-text-muted hover:text-kur-text'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="max-h-[320px] overflow-auto p-3">
          {bottom === 'trades' && (
            <>
              {trades.data && trades.data.length > 0 ? (
                <table className="w-full min-w-[520px] text-left text-[10px]">
                  <thead>
                    <tr className="uppercase tracking-wider text-kur-text-muted">
                      <th className="px-2 py-1 font-medium">Bloco</th>
                      <th className="px-2 py-1 font-medium">Preço</th>
                      <th className="px-2 py-1 font-medium">Volume</th>
                      <th className="px-2 py-1 font-medium">Tx</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...trades.data].reverse().slice(0, 40).map((trade) => (
                      <tr key={`${trade.txHash}-${trade.blockNumber}`} className="border-t border-kur-border/50">
                        <td className="px-2 py-1 font-mono text-kur-text-muted">{trade.blockNumber}</td>
                        <td className="px-2 py-1 font-mono text-kur-text">{trade.price ? fmtPrice(trade.price) : '—'}</td>
                        <td className="px-2 py-1 font-mono text-kur-text-muted">{fmtUsd(trade.volumeUsd)}</td>
                        <td className="px-2 py-1">
                          <a
                            href={explorerTxUrl(chainId, trade.txHash)}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-kur-accent hover:underline"
                          >
                            {shortHash(trade.txHash)}
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="py-6 text-center text-[11px] text-kur-text-muted">Sem trades no período.</p>
              )}
            </>
          )}

          {bottom === 'pools' && (
            <PoolsTable pools={pools.data ?? []} selected={pool?.address} compact onSelect={(next) => setSelected(next.address)} />
          )}

          {bottom === 'transactions' && <TxTable transactions={transactions.transactions.slice(0, 20)} compact />}

          {bottom === 'events' && (
            <>
              {trades.data && trades.data.length > 0 ? (
                <div className="space-y-1 font-mono text-[9px] text-kur-text-muted">
                  {[...trades.data].reverse().slice(0, 40).map((trade) => (
                    <div key={`event-${trade.txHash}-${trade.blockNumber}`} className="flex flex-wrap gap-2">
                      <span className="text-kur-accent">Swap</span>
                      <span>bloco {trade.blockNumber}</span>
                      <span>
                        in {fmtAmount(trade.amount0In, pool?.token0.decimals ?? 18, 4)} {pool?.token0.symbol ?? ''} +{' '}
                        {fmtAmount(trade.amount1In, pool?.token1.decimals ?? 18, 4)} {pool?.token1.symbol ?? ''}
                      </span>
                      <span className="truncate">tx {shortHash(trade.txHash)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-6 text-center text-[11px] text-kur-text-muted">Nenhum evento na janela.</p>
              )}
            </>
          )}

          {bottom === 'orders' && (
            <EmptyState
              compact
              icon="📒"
              title="Em desenvolvimento — sem livro de ordens"
              description="O KurRouter é um AMM puro (x*y=k): não existe matching de ordens on-chain. Um livro de ordens exigiria um contrato novo; a interface não simula ordens."
            />
          )}
        </div>
      </Panel>
    </div>
  );
}
