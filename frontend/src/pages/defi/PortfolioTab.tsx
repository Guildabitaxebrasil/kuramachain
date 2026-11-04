import { useNetwork } from '../../context/NetworkContext';
import { usePortfolio } from '../../hooks/usePortfolio';
import { useStaking } from '../../hooks/useStaking';
import { useLending } from '../../hooks/useLending';
import { useTransactions } from '../../hooks/useTransactions';
import Panel from '../../components/defi/Panel';
import StatTile from '../../components/defi/StatTile';
import PriceChart from '../../components/defi/PriceChart';
import TokensTable from '../../components/defi/TokensTable';
import TxTable from '../../components/defi/TxTable';
import EmptyState from '../../components/defi/EmptyState';
import InfoRow from '../../components/defi/InfoRow';
import { fmtAmount, fmtApr, fmtPct, fmtUsd } from '../../utils/format';

export default function PortfolioTab() {
  const { chainId, account, chain } = useNetwork();
  const portfolio = usePortfolio(chainId, account);
  const staking = useStaking(chainId, account);
  const lending = useLending(chainId, account);
  const transactions = useTransactions(chainId, account, 'all');

  if (!account) {
    return (
      <Panel title="Portfólio" subtitle={chain.name}>
        <EmptyState
          icon="👛"
          title="Conecte a carteira"
          description="O portfólio agrega saldos, LP, staking, lending e rewards da conta conectada. Tudo lido on-chain — sem conta custodiada."
        />
      </Panel>
    );
  }

  const data = portfolio.data;
  const stakingPositions = (staking.data ?? []).filter((pool) => pool.myStaked > 0n || pool.myPending > 0n);
  const lendingReserves = (lending.data?.reserves ?? []).filter(
    (reserve) => reserve.mySupplied > 0n || reserve.myDebt > 0n,
  );
  const rewards = stakingPositions
    .filter((pool) => pool.myPending > 0n)
    .map((pool) => ({ pool, amount: pool.myPending }));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Valor total"
          value={fmtUsd(data?.totalUsd ?? null)}
          hint={`${data?.holdings.filter((item) => item.balance > 0n).length ?? 0} token(s) + ${data?.lps.length ?? 0} LP`}
          icon="💼"
          tone="accent"
        />
        <StatTile label="P&L 24h" value={fmtPct(portfolio.change24h)} hint="vs snapshot local" tone="green" />
        <StatTile label="P&L 7d" value={fmtPct(portfolio.change7d)} hint="vs snapshot local" tone="violet" />
        <StatTile label="P&L 30d" value={fmtPct(portfolio.change30d)} hint="vs snapshot local" tone="yellow" />
      </div>

      {data && data.unpricedTokens > 0 && (
        <p className="rounded-xl border border-kur-yellow/30 bg-kur-yellow/5 px-3 py-2 text-[11px] text-kur-yellow">
          {data.unpricedTokens} token(s) com saldo sem preço on-chain — o total mostra apenas o que tem
          fonte de preço.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.3fr_0.7fr]">
        <Panel title="Evolução do portfólio" subtitle="Snapshots gravados por esta interface">
          <PriceChart
            id="portfolio"
            data={portfolio.history.map((point) => ({ t: point.t, v: point.valueUsd }))}
            format="usd"
            color="#3fb950"
            height={220}
          />
        </Panel>
        <Panel title="Resumo" subtitle="Posições on-chain">
          <InfoRow label="Tokens com saldo" value={data?.holdings.filter((item) => item.balance > 0n).length ?? 0} />
          <InfoRow label="LP tokens" value={data?.lps.length ?? 0} />
          <InfoRow label="Pools em staking" value={stakingPositions.length} />
          <InfoRow label="Reservas no lending" value={lendingReserves.length} />
          <InfoRow
            label="Health factor"
            value={lending.data?.account?.healthFactor ? lending.data.account.healthFactor.toFixed(3) : '—'}
            tone={(lending.data?.account?.healthFactor ?? 2) < 1 ? 'negative' : 'positive'}
          />
          <InfoRow label="Rewards pendentes" value={`${rewards.length} pool(s)`} />
        </Panel>
      </div>

      <Panel title="Tokens" subtitle="Saldo, preço e valor">
        <TokensTable chainId={chainId} holdings={data?.holdings ?? []} account={account} />
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Posições de liquidez" subtitle="LP = participação nas reservas do par">
          {data?.lps.length ? (
            <div className="space-y-2">
              {data.lps.map((position) => (
                <div
                  key={position.pool.address}
                  className="rounded-xl border border-kur-border/70 bg-kur-bg/30 p-2.5 text-[11px]"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-kur-text">
                      {position.pool.token0.symbol}/{position.pool.token1.symbol}
                    </span>
                    <span className="text-kur-green">{fmtUsd(position.valueUsd)}</span>
                  </div>
                  <p className="mt-1 text-[10px] text-kur-text-muted">
                    {fmtAmount(position.amount0, position.pool.token0.decimals, 4)} {position.pool.token0.symbol} +{' '}
                    {fmtAmount(position.amount1, position.pool.token1.decimals, 4)} {position.pool.token1.symbol} ·{' '}
                    {(position.share * 100).toFixed(4)}% do pool
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact icon="💧" title="Sem liquidez provida" />
          )}
        </Panel>

        <Panel title="Staking & rewards" subtitle="KurStaking">
          {stakingPositions.length ? (
            <div className="space-y-2">
              {stakingPositions.map((pool) => (
                <div key={pool.pid} className="rounded-xl border border-kur-border/70 bg-kur-bg/30 p-2.5 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-kur-text">
                      Pool #{pool.pid} · {pool.stakingToken.symbol}
                    </span>
                    <span className="text-kur-accent">{fmtApr(pool.aprPct)} APR</span>
                  </div>
                  <p className="mt-1 text-[10px] text-kur-text-muted">
                    em stake: {fmtAmount(pool.myStaked, pool.stakingToken.decimals, 4)} · pendente:{' '}
                    {fmtAmount(pool.myPending, pool.rewardToken.decimals, 4)} {pool.rewardToken.symbol}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact icon="🌱" title="Sem posição em staking" />
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Lending" subtitle="KurLendingPool (posição)">
          {lendingReserves.length ? (
            <div className="space-y-2">
              {lendingReserves.map((reserve) => (
                <div key={reserve.asset.address} className="flex items-center justify-between text-[11px]">
                  <span className="text-kur-text">{reserve.asset.symbol}</span>
                  <span className="font-mono text-[10px] text-kur-text-muted">
                    supply {fmtAmount(reserve.mySupplied, reserve.asset.decimals, 4)} · debt{' '}
                    {fmtAmount(reserve.myDebt, reserve.asset.decimals, 4)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact icon="🏦" title="Sem posição no lending" />
          )}
        </Panel>

        <Panel title="Rewards a resgatar" subtitle="Claim no KurStaking">
          {rewards.length ? (
            <div className="space-y-1 text-[11px]">
              {rewards.map(({ pool, amount }) => (
                <div key={pool.pid} className="flex items-center justify-between">
                  <span className="text-kur-text-muted">Pool #{pool.pid}</span>
                  <span className="font-mono text-kur-green">
                    {fmtAmount(amount, pool.rewardToken.decimals, 6)} {pool.rewardToken.symbol}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-kur-text-muted">Nenhum reward pendente.</p>
          )}
        </Panel>
      </div>

      <Panel title="Histórico recente" subtitle="Transações enviadas por esta interface">
        <TxTable transactions={transactions.transactions.slice(0, 8)} compact />
      </Panel>
    </div>
  );
}
