/**
 * Tipos do domínio DeFi (multi-chain).
 *
 * Tudo que é valor on-chain usa `bigint` (wei/units); `number` é usado apenas
 * para grandezas de exibição (USD, percentuais, timestamps em segundos).
 */

export type RpcStatus = 'connected' | 'slow' | 'offline' | 'unknown';

export interface RpcHealth {
  chainId: number;
  status: RpcStatus;
  latencyMs: number | null;
  url: string;
  lastChecked: number;
  error: string | null;
}

export type ChainKind = 'kurama' | 'evm';

export interface NativeCurrency {
  name: string;
  symbol: string;
  decimals: number;
}

export interface ExplorerConfig {
  name: string;
  /** Base sem barra final (ex.: `https://polygonscan.com`). */
  baseUrl: string;
  txPath: string;
  addressPath: string;
}

export interface ChainConfig {
  id: number;
  name: string;
  shortName: string;
  kind: ChainKind;
  native: NativeCurrency;
  rpcUrls: string[];
  explorer: ExplorerConfig;
  /** Endereço ERC-20 do nativo (para preço/leitura de pool). */
  wrappedNative?: string;
  /** Uniswap V3 factory (mesmo endereço canônico nas redes onde foi deployada). */
  uniswapV3Factory?: string;
  /** Swap executável pela UI nesta rede? */
  swapExecution: boolean;
  /** Tempo médio de bloco (s), usado para janelas de volume. */
  blockTimeSeconds: number;
  /** Tempo médio de bloco (s), usado para janelas de volume. */
  color: string;
  testnet?: boolean;
}

export type TokenTag = 'native' | 'stable' | 'wrapped' | 'base' | 'governance' | 'custom';

export interface TokenConfig {
  chainId: number;
  /** `NATIVE_TOKEN` para o ativo nativo. */
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  tags: TokenTag[];
  logo?: string;
  /** Endereço vindo de fonte verificada (lista oficial / contrato nosso). */
  verified: boolean;
}

export type ContractKey =
  | 'token'
  | 'wrappedNative'
  | 'factory'
  | 'router'
  | 'oracle'
  | 'priceFeed'
  | 'priceOracle'
  | 'staking'
  | 'lendingPool'
  | 'bridge'
  | 'wrappedToken'
  | 'uniswapFactory'
  | 'uniswapRouter'
  | 'uniswapQuoter';

export interface ContractEntry {
  key: ContractKey;
  label: string;
  address: string;
  chainId: number;
  version: string;
  enabled: boolean;
  source: 'env' | 'local' | 'default';
}

export interface TokenMeta {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
}

export type PoolDex = 'kur' | 'uniswap-v3';

export interface PoolInfo {
  chainId: number;
  address: string;
  dex: PoolDex;
  token0: TokenMeta;
  token1: TokenMeta;
  reserve0: bigint;
  reserve1: bigint;
  /** Supply do LP token (AMM) ou liquidez ativa (V3). */
  lpSupply: bigint;
  /** 0.003 no AMM; taxa do tier / 1e6 no V3. */
  fee: number;
  price0Usd: number | null;
  price1Usd: number | null;
  tvlUsd: number | null;
  myLp?: bigint;
  myShare?: number;
}

export interface RouteHop {
  tokenIn: TokenMeta;
  tokenOut: TokenMeta;
  pair: string;
  protocol: string;
  amountIn: bigint;
  amountOut: bigint;
  feeBps: number;
}

export interface SwapAlternative {
  label: string;
  amountOut: bigint;
}

export interface SwapQuote {
  chainId: number;
  dex: PoolDex;
  tokenIn: TokenMeta;
  tokenOut: TokenMeta;
  amountIn: bigint;
  amountOut: bigint;
  amountOutMin: bigint;
  hops: RouteHop[];
  routeLabel: string;
  /** Preço médio de execução (tokenOut por tokenIn). */
  execPrice: number | null;
  /** Preço de mercado antes do trade (mesma unidade). */
  midPrice: number | null;
  priceImpactPct: number | null;
  protocolFeeBps: number;
  feeTier?: number;
  allowance: bigint;
  needsApproval: boolean;
  gasEstimate: bigint | null;
  alternatives: SwapAlternative[];
  slippageBps: number;
}

export type TxKind = 'swap' | 'transfer' | 'liquidity' | 'staking' | 'lending' | 'bridge' | 'approve';

export type TxStatus = 'pending' | 'confirmed' | 'failed';

export interface TxRecord {
  hash: string;
  chainId: number;
  kind: TxKind;
  status: TxStatus;
  account: string;
  to?: string;
  contract?: string;
  tokenIn?: TokenMeta;
  tokenOut?: TokenMeta;
  amountIn?: string;
  amountOut?: string;
  description: string;
  explorerUrl: string;
  createdAt: number;
  confirmedAt?: number;
  blockNumber?: number;
  gasUsed?: string;
  error?: string;
}

export interface StakingPool {
  pid: number;
  stakingToken: TokenMeta;
  rewardToken: TokenMeta;
  rewardRate: bigint;
  rewardEnd: number;
  totalStaked: bigint;
  rewardBudget: bigint;
  aprPct: number | null;
  /** Fração do prêmio já distribuída (0-1). */
  distributedRatio: number | null;
  myStaked: bigint;
  myPending: bigint;
}

export interface LendingReserve {
  asset: TokenMeta;
  aToken: string;
  debtToken: string;
  ltvBps: number;
  thresholdBps: number;
  bonusBps: number;
  reserveFactorBps: number;
  supplied: bigint;
  borrowed: bigint;
  available: bigint;
  utilizationPct: number | null;
  supplyApyPct: number | null;
  borrowApyPct: number | null;
  priceUsd: number | null;
  mySupplied: bigint;
  myDebt: bigint;
}

export interface LendingAccount {
  collateralUsd: number | null;
  debtUsd: number | null;
  availableBorrowUsd: number | null;
  liquidationThresholdBps: number;
  ltvBps: number;
  /** `null` = sem dívida (health infinito) ou dado indisponível. */
  healthFactor: number | null;
  hasDebt: boolean;
}

export interface PriceResult {
  usd: number | null;
  source: string;
  updatedAt: number | null;
}

export interface OracleReading {
  label: string;
  price: number | null;
  decimals: number | null;
  source: string;
  updatedAt: number | null;
  fresh: boolean | null;
  extra?: string;
}

export interface TimeSeriesPoint {
  t: number;
  v: number;
}

export interface TokenBalance {
  token: TokenConfig;
  balance: bigint;
  priceUsd: number | null;
  valueUsd: number | null;
  source: string;
}

export interface PortfolioSnapshot {
  t: number;
  valueUsd: number;
}

export interface PairTrade {
  txHash: string;
  blockNumber: number;
  timestamp: number | null;
  /** `token0` por `token1` no momento do trade. */
  price: number | null;
  amount0In: bigint;
  amount1In: bigint;
  amount0Out: bigint;
  amount1Out: bigint;
  volumeUsd: number | null;
}

export interface IntelligenceInsight {
  id: string;
  title: string;
  detail: string;
  tone: 'positive' | 'negative' | 'neutral' | 'warning';
}
