/**
 * Registro de redes EVM suportadas pela DeFi da Kurama.
 *
 * - **KuramaChain (9090)** é a rede nativa: RPC do próprio nó (`/rpc`), swap
 *   executável no `KurRouter`.
 * - As redes públicas usam apenas endpoints/RPCs documentados. Contratos
 *   Uniswap V3 só entram onde o endereço é comprovado (factory canônica e, na
 *   Polygon, router/quoter já usados por `api/uniswap.ts`).
 */
import type { ChainConfig } from '../types/defi';
import { UNISWAP } from '../api/uniswap';

/** Chain ID da EVM da KuramaChain. */
export const KURAMA_CHAIN_ID = 9090;

/** Sentinela de "ativo nativo" (convenção de agregadores e da Uniswap). */
export const NATIVE_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

/** UniswapV3Factory — mesmo endereço canônico nas redes onde foi deployada. */
export const UNISWAP_V3_FACTORY = '0x1F98431c8aD98523631AE4a59f267346ea31F984';

function envValue(name: string): string | undefined {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const value = env?.[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function unique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => !!value)));
}

/**
 * URLs JSON-RPC da KuramaChain.
 *
 * O padrão é o próprio RPC servido pelo frontend (`<origem>/rpc`, que o proxy do
 * Vite encaminha para o nó). `VITE_EVM_RPC_URL` permite apontar direto para o
 * nó (a wallet exige URL absoluta).
 */
export function kuramaRpcUrls(): string[] {
  const fromEnv = envValue('VITE_EVM_RPC_URL');
  const origin =
    typeof window !== 'undefined' ? `${window.location.origin}/rpc` : 'http://localhost:5000/rpc';
  return unique([fromEnv, origin]);
}

function appOrigin(): string {
  return typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
}

/** Explorers públicos (documentados) das redes externas. */
export const CHAINS: ChainConfig[] = [
  {
    id: KURAMA_CHAIN_ID,
    name: 'KuramaChain',
    shortName: 'Kurama',
    kind: 'kurama',
    native: { name: 'Kurama', symbol: 'KUR', decimals: 18 },
    rpcUrls: [],
    explorer: {
      name: 'Kurama Explorer',
      baseUrl: appOrigin(),
      txPath: '/transactions',
      addressPath: '/wallet',
    },
    swapExecution: true,
    blockTimeSeconds: 30,
    color: '#58a6ff',
  },
  {
    id: 1,
    name: 'Ethereum',
    shortName: 'Ethereum',
    kind: 'evm',
    native: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: [
      envValue('VITE_ETHEREUM_RPC_URL') ?? 'https://ethereum-rpc.publicnode.com',
      'https://cloudflare-eth.com',
      'https://eth.drpc.org',
    ].filter(Boolean),
    explorer: {
      name: 'Etherscan',
      baseUrl: 'https://etherscan.io',
      txPath: '/tx/',
      addressPath: '/address/',
    },
    wrappedNative: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    uniswapV3Factory: UNISWAP_V3_FACTORY,
    swapExecution: false,
    blockTimeSeconds: 12,
    color: '#627eea',
  },
  {
    id: 137,
    name: 'Polygon',
    shortName: 'Polygon',
    kind: 'evm',
    native: { name: 'Polygon', symbol: 'POL', decimals: 18 },
    rpcUrls: [
      envValue('VITE_POLYGON_RPC_URL') ?? 'https://polygon-bor-rpc.publicnode.com',
      'https://1rpc.io/matic',
      'https://polygon.drpc.org',
    ].filter(Boolean),
    explorer: {
      name: 'Polygonscan',
      baseUrl: 'https://polygonscan.com',
      txPath: '/tx/',
      addressPath: '/address/',
    },
    wrappedNative: UNISWAP.wmatic,
    uniswapV3Factory: UNISWAP.factory,
    swapExecution: true,
    blockTimeSeconds: 2,
    color: '#8247e5',
  },
  {
    id: 56,
    name: 'BNB Chain',
    shortName: 'BNB',
    kind: 'evm',
    native: { name: 'BNB', symbol: 'BNB', decimals: 18 },
    rpcUrls: [
      envValue('VITE_BNB_RPC_URL') ?? 'https://bsc-dataseed.binance.org',
      'https://bsc-rpc.publicnode.com',
      'https://1rpc.io/bnb',
    ].filter(Boolean),
    explorer: {
      name: 'BscScan',
      baseUrl: 'https://bscscan.com',
      txPath: '/tx/',
      addressPath: '/address/',
    },
    wrappedNative: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
    uniswapV3Factory: UNISWAP_V3_FACTORY,
    swapExecution: false,
    blockTimeSeconds: 3,
    color: '#f0b90b',
  },
  {
    id: 42161,
    name: 'Arbitrum One',
    shortName: 'Arbitrum',
    kind: 'evm',
    native: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: [
      envValue('VITE_ARBITRUM_RPC_URL') ?? 'https://arb1.arbitrum.io/rpc',
      'https://arbitrum-one-rpc.publicnode.com',
      'https://1rpc.io/arb',
    ].filter(Boolean),
    explorer: {
      name: 'Arbiscan',
      baseUrl: 'https://arbiscan.io',
      txPath: '/tx/',
      addressPath: '/address/',
    },
    wrappedNative: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    uniswapV3Factory: UNISWAP_V3_FACTORY,
    swapExecution: false,
    blockTimeSeconds: 0.25,
    color: '#28a0f0',
  },
  {
    id: 10,
    name: 'Optimism',
    shortName: 'Optimism',
    kind: 'evm',
    native: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: [
      envValue('VITE_OPTIMISM_RPC_URL') ?? 'https://mainnet.optimism.io',
      'https://optimism-rpc.publicnode.com',
      'https://1rpc.io/op',
    ].filter(Boolean),
    explorer: {
      name: 'Optimism Explorer',
      baseUrl: 'https://optimistic.etherscan.io',
      txPath: '/tx/',
      addressPath: '/address/',
    },
    wrappedNative: '0x4200000000000000000000000000000000000006',
    uniswapV3Factory: UNISWAP_V3_FACTORY,
    swapExecution: false,
    blockTimeSeconds: 2,
    color: '#ff0420',
  },
  {
    id: 8453,
    name: 'Base',
    shortName: 'Base',
    kind: 'evm',
    native: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: [
      envValue('VITE_BASE_RPC_URL') ?? 'https://mainnet.base.org',
      'https://base-rpc.publicnode.com',
      'https://1rpc.io/base',
    ].filter(Boolean),
    explorer: {
      name: 'Basescan',
      baseUrl: 'https://basescan.org',
      txPath: '/tx/',
      addressPath: '/address/',
    },
    wrappedNative: '0x4200000000000000000000000000000000000006',
    uniswapV3Factory: UNISWAP_V3_FACTORY,
    swapExecution: false,
    blockTimeSeconds: 2,
    color: '#0052ff',
  },
  {
    id: 43114,
    name: 'Avalanche C-Chain',
    shortName: 'Avalanche',
    kind: 'evm',
    native: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
    rpcUrls: [
      envValue('VITE_AVALANCHE_RPC_URL') ?? 'https://api.avax.network/ext/bc/C/rpc',
      'https://avalanche-c-chain-rpc.publicnode.com',
      'https://1rpc.io/avax/c',
    ].filter(Boolean),
    explorer: {
      name: 'Snowtrace',
      baseUrl: 'https://snowtrace.io',
      txPath: '/tx/',
      addressPath: '/address/',
    },
    wrappedNative: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
    uniswapV3Factory: UNISWAP_V3_FACTORY,
    swapExecution: false,
    blockTimeSeconds: 2,
    color: '#e84142',
  },
];

export function getChain(chainId: number): ChainConfig | undefined {
  return CHAINS.find((chain) => chain.id === chainId);
}

/** URL do JSON-RPC por rede (Kurama é resolvida em runtime). */
export function rpcUrlsForChain(chainId: number): string[] {
  if (chainId === KURAMA_CHAIN_ID) return kuramaRpcUrls();
  return getChain(chainId)?.rpcUrls ?? [];
}

export function explorerTxUrl(chainId: number, hash: string): string {
  const chain = getChain(chainId);
  if (!chain) return '';
  // A KuramaChain usa o próprio explorer da app (rotas do SPA), não um
  // `/tx/<hash>` externo.
  if (chain.kind === 'kurama') {
    return `${chain.explorer.baseUrl}${chain.explorer.txPath}?hash=${encodeURIComponent(hash)}`;
  }
  return `${chain.explorer.baseUrl}${chain.explorer.txPath}${hash}`;
}

export function explorerAddressUrl(chainId: number, address: string): string {
  const chain = getChain(chainId);
  if (!chain) return '';
  if (chain.kind === 'kurama') {
    return `${chain.explorer.baseUrl}${chain.explorer.addressPath}?address=${encodeURIComponent(address)}`;
  }
  return `${chain.explorer.baseUrl}${chain.explorer.addressPath}${address}`;
}

export function chainName(chainId: number): string {
  return getChain(chainId)?.name ?? `Chain ${chainId}`;
}

/** Chains com leitura de mercado (Kurama ou factory Uniswap V3 configurada). */
export function marketplaceChains(): ChainConfig[] {
  return CHAINS.filter((chain) => chain.kind === 'kurama' || !!chain.uniswapV3Factory);
}
