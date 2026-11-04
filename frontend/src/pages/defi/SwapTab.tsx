import { useState } from 'react';
import { useNetwork } from '../../context/NetworkContext';
import Panel from '../../components/defi/Panel';
import SwapPanel from '../../components/defi/SwapPanel';
import EmptyState from '../../components/defi/EmptyState';
import UniswapCard from '../../components/UniswapCard';
import SwapCard from '../../components/SwapCard';
import { KURAMA_CHAIN_ID } from '../../chains/chains';

export default function SwapTab() {
  const { chainId, chain } = useNetwork();
  const [advanced, setAdvanced] = useState(false);

  if (chainId === 137) {
    return (
      <div className="space-y-4">
        <UniswapCard />
        <Panel title="Swap na Polygon" subtitle="Uniswap V3 · pools reais na chain 137">
          <p className="text-[11px] leading-relaxed text-kur-text-muted">
            A cotação vem do <code>QuoterV2</code> e o swap vai para o <code>SwapRouter02</code>, assinado
            pela sua carteira. MATIC nativo entra como <code>value</code> e sai via <code>unwrapWETH9</code>.
            O contrato do KurRouter só existe na KuramaChain — por isso esta aba usa o roteador da Uniswap.
          </p>
        </Panel>
      </div>
    );
  }

  if (chainId !== KURAMA_CHAIN_ID) {
    return (
      <Panel title="Swap" subtitle={`${chain.name} · ${chainId}`}>
        <EmptyState
          icon="⛓️"
          title="Swap não configurado nesta rede"
          description="Só existem roteadores comprovados para execução na KuramaChain (KurRouter) e na Polygon (Uniswap SwapRouter02). Nas demais redes a interface lê mercado/pools, mas não assina swap."
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <SwapPanel />
      <Panel
        title="Modo avançado"
        subtitle="Swap manual (router/tokens colados) — útil quando o contrato ainda não está no registry"
        actions={
          <button
            type="button"
            onClick={() => setAdvanced((value) => !value)}
            className="rounded-lg border border-kur-border px-2 py-1 text-[10px] text-kur-text-muted hover:text-kur-text"
          >
            {advanced ? 'ocultar' : 'mostrar'}
          </button>
        }
      >
        {advanced ? (
          <SwapCard />
        ) : (
          <p className="text-[11px] text-kur-text-muted">
            O modo avançado reutiliza o card original do DEX (informando o endereço do KurRouter e os
            tokens manualmente). O painel acima já faz o mesmo usando o registro de contratos.
          </p>
        )}
      </Panel>
    </div>
  );
}
