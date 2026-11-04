import type { PoolInfo } from '../../types/defi';
import { fmtAmount, fmtUsd, shortAddress } from '../../utils/format';
import EmptyState from './EmptyState';

interface Props {
  pools: PoolInfo[];
  selected?: string | null;
  onSelect?: (pool: PoolInfo) => void;
  volumes?: Record<string, number | null>;
  showMine?: boolean;
  compact?: boolean;
}

export default function PoolsTable({ pools, selected, onSelect, volumes, showMine, compact }: Props) {
  if (!pools.length) {
    return (
      <EmptyState
        compact
        icon="💧"
        title="Nenhum pool encontrado"
        description="O factory desta rede não tem pares (ou o contrato não está configurado). Crie um par no KurFactory e adicione liquidez pelo KurRouter."
      />
    );
  }

  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[620px] text-left text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-kur-text-muted">
            <th className="px-2 py-2 font-medium">Pool</th>
            <th className="px-2 py-2 font-medium">DEX</th>
            <th className="px-2 py-2 font-medium">TVL</th>
            <th className="px-2 py-2 font-medium">Reservas</th>
            {volumes && <th className="px-2 py-2 font-medium">Volume 24h</th>}
            {showMine && <th className="px-2 py-2 font-medium">Minha liquidez</th>}
            <th className="px-2 py-2 font-medium">Par</th>
          </tr>
        </thead>
        <tbody>
          {pools.map((pool) => {
            const active = selected === pool.address;
            return (
              <tr
                key={pool.address}
                onClick={() => onSelect?.(pool)}
                className={`border-t border-kur-border/60 ${
                  onSelect ? 'cursor-pointer' : ''
                } ${active ? 'bg-kur-accent/5' : 'hover:bg-kur-bg-hover/40'}`}
              >
                <td className="px-2 py-2">
                  <div className="flex items-center gap-1.5 font-medium text-kur-text">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-kur-accent/15 text-[9px] text-kur-accent">
                      {pool.token0.symbol.slice(0, 2)}
                    </span>
                    <span>{pool.token0.symbol}/{pool.token1.symbol}</span>
                  </div>
                  {!compact && (
                    <p className="mt-0.5 font-mono text-[9px] text-kur-text-muted">
                      {shortAddress(pool.address, 6)}
                    </p>
                  )}
                </td>
                <td className="px-2 py-2 text-[10px] text-kur-text-muted">
                  {pool.dex === 'kur' ? 'KurFactory' : `Uniswap V3 ${(pool.fee * 100).toFixed(2)}%`}
                </td>
                <td className="px-2 py-2 font-mono text-[11px] text-kur-text">{fmtUsd(pool.tvlUsd)}</td>
                <td className="px-2 py-2 font-mono text-[10px] text-kur-text-muted">
                  {fmtAmount(pool.reserve0, pool.token0.decimals, 2)} {pool.token0.symbol}
                  <span className="block">
                    {fmtAmount(pool.reserve1, pool.token1.decimals, 2)} {pool.token1.symbol}
                  </span>
                </td>
                {volumes && (
                  <td className="px-2 py-2 font-mono text-[10px] text-kur-text">
                    {fmtUsd(volumes[pool.address.toLowerCase()] ?? null)}
                  </td>
                )}
                {showMine && (
                  <td className="px-2 py-2 font-mono text-[10px]">
                    {(pool.myLp ?? 0n) > 0n ? (
                      <>
                        <span className="text-kur-green">
                          {pool.myShare ? `${(pool.myShare * 100).toFixed(3)}%` : '—'}
                        </span>
                        <span className="block text-[9px] text-kur-text-muted">
                          {fmtAmount(pool.myLp ?? 0n, 18, 3)} LP
                        </span>
                      </>
                    ) : (
                      <span className="text-kur-text-muted">—</span>
                    )}
                  </td>
                )}
                <td className="px-2 py-2">
                  <a
                    href={`#pool-${pool.address}`}
                    onClick={(event) => event.stopPropagation()}
                    className="font-mono text-[9px] text-kur-accent hover:underline"
                    title={pool.address}
                  >
                    {shortAddress(pool.address, 4)}
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
