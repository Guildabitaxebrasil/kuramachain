# Kurama DeFi — plano de implementação

> Documento de trabalho da reconstrução da página `/defi` em uma plataforma DeFi
> multi-chain, com dados **reais** (on-chain) e sem endereços inventados.

## 1. Diagnóstico do que existe hoje

| Área | Estado | Arquivo |
|------|--------|---------|
| EVM + JSON-RPC `eth_*` (chain 9090) | ✅ funciona | `evm/engine.py`, `evm/rpc.py` |
| DEX AMM `x*y=k` + LP | ✅ contratos + testes | `KurFactory/KurPair/KurRouter`, `tests/test_dex.py` |
| Swap na wallet (DEX Kurama) | ✅ funciona | `frontend/src/components/SwapCard.tsx`, `api/dex.ts`, `api/evmAbi.ts` |
| Swap Uniswap V3 na Polygon | ✅ funciona | `frontend/src/components/UniswapCard.tsx`, `api/uniswap.ts` |
| Oraculo / Lending / Staking / Bridge | ✅ contratos + relayer + testes | `evm/contracts/*.sol`, `evm/bridge.py` |
| **Leitura DeFi no frontend** | ❌ **falsa** | `frontend/src/api/defi.ts` devolve token “Kurama Token/KUR/18”, preço 0 e posição zerada sem chamar o contrato |
| Página `/defi` | ⚠️ 6 abas, endereços colados à mão, sem multi-chain, sem portfólio | `frontend/src/pages/DeFi.tsx` |
| Endpoint de deployments | ❌ não existe | nenhum `/api/defi/*` no backend |
| Bridge para Polygon | ❌ inexistente (bridge é genérico) | `evm/bridge.py`, `KurBridge.sol` |

Consequências para o plano:

1. **Nada de dados falsos**: `api/defi.ts` precisa ser substituído por leitura
   ABI real (`defi.ts` novo em `services/`), e o que não estiver configurado
   aparece como “Contrato não configurado”.
2. **Endereços** vêm de `VITE_*` ou do que o usuário salva na UI
   (`localStorage`). Tokens de redes públicas vêm da lista oficial da Uniswap
   (`tokens.uniswap.org`), já conferida; contratos Uniswap V3 só são usados
   onde o endereço é comprovado (Polygon, no `api/uniswap.ts`).
3. **Multi-chain** é uma camada de configuração, não uma reescrita: a chain 9090
   continua sendo a única com swap executável pelo `KurRouter`; as outras redes
   oferecem leitura de mercado/pool (Uniswap V3 factory canônica) e, na Polygon,
   swap completo (já existente).
4. **Preservar** `SwapCard`, `UniswapCard`, `EvmWalletCard`, `api/dex.ts`,
   `api/uniswap.ts`, `api/evmAbi.ts`: são a base testada e reutilizada.

## 2. Arquitetura alvo do frontend

```
frontend/src/
├── chains/           # registro das redes (id, RPC, explorer, nativo, wrapped)
├── tokens/           # registro de tokens por rede + tokens customizados
├── contracts/        # registry de contratos (address, chainId, version, enabled)
├── abi/              # seletores keccak gerados + encoders/decoders ABI
├── types/            # tipos do domínio DeFi
├── services/         # rpc (fallback), prices, pools, swap, portfolio,
│                     # txStore, oracle, staking, lending, bridge, analytics
├── hooks/            # useNetwork, useSwap, usePools, usePortfolio, ...
├── context/          # NetworkContext, ToastContext
├── components/defi/  # UI compartilhada (cards, tabelas, gráficos, modais)
└── pages/defi/       # uma aba por arquivo + shell da página
```

Regras:

- **Sem ethers.js/web3.js**: mantém-se a codificação ABI manual (`abi/`), como já
  faz o DEX.
- **RPC com fallback**: lista de URLs por rede; se a principal falhar, tenta a
  seguinte e mostra 🟢/🟡/🔴 por rede.
- **Cache + polling controlado**: `eth_call` com TTL, debounce nas cotações,
  sem refetch a cada render.
- **Contratos**: `address`, `chainId`, `abi`, `version`, `enabled` — quando
  `enabled` é falso a UI mostra “Contrato não configurado”.

## 3. Etapas

| Etapa | Entrega | Critério |
|-------|---------|----------|
| **0. Fundação** | `chains/`, `tokens/`, `contracts/`, `abi/`, `types/`, RPC com fallback e cache | `tsc` passa; leitura de `eth_chainId`/`eth_call` em 8 redes |
| **1. Dados reais** | `services/prices`, `pools`, `swap`, `portfolio`, `txStore` | pools do `KurFactory` reais; cotação multi-hop; portfólio e histórico com recibo on-chain |
| **2. Serviços DeFi** | oráculo, staking, lending, bridge, analytics, intelligence | leitura dos contratos existentes; escrita assinada pela wallet; “não configurado” quando faltar endereço |
| **3. UI** | shell com abas (Dashboard, Swap, Markets, Pools, Liquidity, Portfolio, Staking, Lending, Bridge, Oracle, Analytics, Transactions, Intelligence, Terminal) | visual profissional, responsivo, dark/glass discreto |
| **4. Segurança/erros** | confirmação “enviar X de Y para contrato Z”, chain/allowance/saldo/gas, keys únicas, cancelamento de requests no unmount | nenhuma transação sem confirmação e recibo |
| **5. Pendências conscientes** | candles de longo prazo (histórico só existe desde a 1ª leitura), WalletConnect, bridge real para Polygon, APR quando não há oráculo USD | sinalizado na UI |

## 4. O que é real vs. o que fica sinalizado

| Recurso | Fonte real |
|---------|-----------|
| TVL / liquidez | reservas do `KurPair` × preço (feed/oráculo DEX) |
| Volume 24h / 7d | eventos `Swap` do par (`eth_getLogs`) |
| Preço | `KurPriceFeed` (chain 9090) ou pool Uniswap V3 (redes públicas) |
| APR staking | `rewardRate` × preço do reward / valor em stake |
| Lending | `getReservesList`, `getReserveData`, `getUserAccountData` |
| Bridge | `KurBridge.deposit`/logs `Deposit` |
| Histórico de preço/TVL | snapshots locais + logs de swap; sem dados → “Histórico insuficiente” |
| APR/APY de pool (DEX) | sem oráculo de fees não há APR honesto → “—” |

## 5. Status da implementação

| Etapa | Estado |
|-------|--------|
| 0. Fundação (chains/tokens/contratos/ABI/RPC) | ✅ |
| 1. Dados reais (preços, pools, swap, portfólio, histórico) | ✅ |
| 2. Serviços DeFi (oráculo, staking, lending, bridge, analytics, intelligence) | ✅ leitura + escrita assinada |
| 3. UI (14 abas + terminal) | ✅ |
| 4. Segurança/erros (confirmação explícita, checagens, keys, unmount) | ✅ |
| 5. Pendências conscientes | candles limitados aos logs consultados; APR de pool sem oráculo de fees; WalletConnect; bridge real para Polygon; taxa do bridge não existe no contrato |

Fora do escopo desta entrega (sinalizado na UI): livro de ordens (o KurRouter é AMM
puro), fee de bridge (o contrato não cobra), APY de pool (não há oráculo de fees) e
histórico anterior à primeira leitura da interface.

## 6. Arquivos novos (referência)

- `frontend/src/chains/chains.ts`
- `frontend/src/tokens/registry.ts`
- `frontend/src/contracts/registry.ts`
- `frontend/src/abi/selectors.ts`, `frontend/src/abi/coders.ts`
- `frontend/src/types/defi.ts`
- `frontend/src/services/{rpc,prices,pools,swap,portfolio,txStore,oracle,staking,lending,bridge,analytics,intelligence}.ts`
- `frontend/src/context/{NetworkContext,ToastContext}.tsx`
- `frontend/src/hooks/{useAsync,useNetwork,useTokenPrice,useTokenBalances,usePools,useSwap,usePortfolio,useTransactions,useGas,useLiquidity,useStaking,useLending,useBridge,useOracle,useAnalytics}.ts`
- `frontend/src/components/defi/*`
- `frontend/src/pages/defi/*` e `frontend/src/pages/DeFi.tsx` (shell)
