import type { TokenHolding } from '../../services/portfolio';
import { priceChangePct } from '../../services/analytics';
import { explorerAddressUrl } from '../../chains/chains';
import { fmtAmount, fmtPct, fmtPrice, fmtUsd, shortAddress } from '../../utils/format';
import EmptyState from './EmptyState';

interface Props {
  chainId: number;
  holdings: TokenHolding[];
  account: string | null;
  onSelect?: (address: string) => void;
}

export default function TokensTable({ chainId, holdings, account, onSelect }: Props) {
  if (!holdings.length) {
    return (
      <EmptyState
        compact
        icon="🪙"
        title="Nenhum token para listar"
        description="Adicione um token customizado no seletor de tokens para acompanhar preço e saldo."
      />
    );
  }

  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[700px] text-left text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-kur-text-muted">
            <th className="px-2 py-2 font-medium">Token</th>
            <th className="px-2 py-2 font-medium">Preço</th>
            <th className="px-2 py-2 font-medium">1h</th>
            <th className="px-2 py-2 font-medium">24h</th>
            <th className="px-2 py-2 font-medium">7d</th>
            <th className="px-2 py-2 font-medium">Saldo</th>
            <th className="px-2 py-2 font-medium">Valor</th>
            <th className="px-2 py-2 font-medium">Fonte</th>
            <th className="px-2 py-2 font-medium">Contrato</th>
          </tr>
        </thead>
        <tbody>
          {holdings.map(({ token, balance, priceUsd, valueUsd, priceSource }) => {
            const change1h = priceChangePct(chainId, token.address, 1);
            const change24h = priceChangePct(chainId, token.address, 24);
            const change7d = priceChangePct(chainId, token.address, 24 * 7);
            return (
              <tr
                key={`${token.chainId}:${token.address}`}
                onClick={() => onSelect?.(token.address)}
                className={`border-t border-kur-border/60 ${onSelect ? 'cursor-pointer hover:bg-kur-bg-hover/40' : ''}`}
              >
                <td className="px-2 py-2">
                  <div className="flex items-center gap-1.5">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-kur-accent/15 text-[9px] font-bold text-kur-accent">
                      {token.symbol.slice(0, 2)}
                    </span>
                    <span className="font-medium text-kur-text">{token.symbol}</span>
                    {!token.verified && (
                      <span className="rounded bg-kur-yellow/10 px-1 text-[9px] text-kur-yellow">custom</span>
                    )}
                  </div>
                  <p className="mt-0.5 max-w-[11rem] truncate text-[10px] text-kur-text-muted">{token.name}</p>
                </td>
                <td className="px-2 py-2 font-mono text-[11px] text-kur-text">{fmtPrice(priceUsd)}</td>
                {[change1h, change24h, change7d].map((change, index) => (
                  <td
                    key={index}
                    className={`px-2 py-2 font-mono text-[10px] ${
                      change === null ? 'text-kur-text-muted' : change >= 0 ? 'text-kur-green' : 'text-kur-red'
                    }`}
                  >
                    {change === null ? '—' : fmtPct(change, 1)}
                  </td>
                ))}
                <td className="px-2 py-2 font-mono text-[10px] text-kur-text">
                  {account ? fmtAmount(balance, token.decimals, 4) : '—'}
                </td>
                <td className="px-2 py-2 font-mono text-[10px] text-kur-text">{fmtUsd(valueUsd)}</td>
                <td className="px-2 py-2 text-[9px] text-kur-text-muted">{priceSource}</td>
                <td className="px-2 py-2">
                  <a
                    href={explorerAddressUrl(chainId, token.address)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    className="font-mono text-[9px] text-kur-accent hover:underline"
                  >
                    {shortAddress(token.address, 4)}
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
