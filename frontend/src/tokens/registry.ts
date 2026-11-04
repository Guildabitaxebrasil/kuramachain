/**
 * Registro de tokens por rede.
 *
 * - Tokens de redes públicas: endereços da lista oficial da Uniswap
 *   (`tokens.uniswap.org`), com símbolo/decimais conferidos.
 * - KuramaChain: KUR nativo + os contratos configurados (`KurToken`, `WKUR`).
 * - Tokens customizados: salvos pelo usuário (`localStorage`), marcados como
 *   `custom` e nunca apresentados como verificados.
 */
import type { TokenConfig, TokenMeta } from '../types/defi';
import { NATIVE_TOKEN, getChain, KURAMA_CHAIN_ID } from '../chains/chains';
import { contractAddress, contractsVersion, subscribeContracts } from '../contracts/registry';
import { isAddress, sameAddress } from '../abi/coders';

export { NATIVE_TOKEN };

const STORAGE_KEY = 'kurama.tokens.v1';

type CustomTokens = Record<string, TokenConfig[]>;

function token(
  chainId: number,
  address: string,
  symbol: string,
  name: string,
  decimals: number,
  tags: TokenConfig['tags'],
  verified = true,
): TokenConfig {
  return { chainId, address, symbol, name, decimals, tags, verified };
}

function native(chainId: number, symbol: string, name: string): TokenConfig {
  return token(chainId, NATIVE_TOKEN, symbol, name, 18, ['native'], true);
}

/** Tokens verificados por rede (fonte: tokens.uniswap.org). */
const BUILTIN: Record<number, TokenConfig[]> = {
  [KURAMA_CHAIN_ID]: [native(KURAMA_CHAIN_ID, 'KUR', 'Kurama')],
  1: [
    native(1, 'ETH', 'Ether'),
    token(1, '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 'WETH', 'Wrapped Ether', 18, ['wrapped']),
    token(1, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 'USDC', 'USDCoin', 6, ['stable']),
    token(1, '0xdAC17F958D2ee523a2206206994597C13D831ec7', 'USDT', 'Tether USD', 6, ['stable']),
    token(1, '0x6B175474E89094C44Da98b954EedeAC495271d0F', 'DAI', 'Dai Stablecoin', 18, ['stable']),
    token(1, '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', 'WBTC', 'Wrapped BTC', 8, ['wrapped']),
    token(1, '0x514910771AF9Ca656af840dff83E8264EcF986CA', 'LINK', 'ChainLink Token', 18, []),
    token(1, '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', 'UNI', 'Uniswap', 18, ['governance']),
  ],
  137: [
    native(137, 'POL', 'Polygon'),
    token(137, '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', 'WMATIC', 'Wrapped Matic', 18, ['wrapped']),
    token(137, '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 'USDC', 'USDCoin', 6, ['stable']),
    token(137, '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', 'USDC.e', 'USDCoin (PoS)', 6, ['stable']),
    token(137, '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', 'USDT', 'Tether USD', 6, ['stable']),
    token(137, '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', 'DAI', 'Dai Stablecoin', 18, ['stable']),
    token(137, '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', 'WETH', 'Wrapped Ether', 18, ['wrapped']),
    token(137, '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', 'WBTC', 'Wrapped BTC', 8, ['wrapped']),
    token(137, '0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39', 'LINK', 'ChainLink Token', 18, []),
    token(137, '0xb33EaAd8d922B1083446DC23f610c2567fB5180f', 'UNI', 'Uniswap', 18, ['governance']),
  ],
  56: [
    native(56, 'BNB', 'BNB'),
    token(56, '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', 'WBNB', 'Wrapped BNB', 18, ['wrapped']),
    token(56, '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 'USDC', 'USDCoin', 18, ['stable']),
    token(56, '0x55d398326f99059fF775485246999027B3197955', 'USDT', 'Tether USD', 18, ['stable']),
    token(56, '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3', 'DAI', 'Dai Stablecoin', 18, ['stable']),
    token(56, '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', 'WETH', 'Wrapped Ether', 18, ['wrapped']),
    token(56, '0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD', 'LINK', 'ChainLink Token', 18, []),
    token(56, '0xBf5140A22578168FD562DCcF235E5D43A02ce9B1', 'UNI', 'Uniswap', 18, ['governance']),
  ],
  42161: [
    native(42161, 'ETH', 'Ether'),
    token(42161, '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', 'WETH', 'Wrapped Ether', 18, ['wrapped']),
    token(42161, '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 'USDC', 'USDCoin', 6, ['stable']),
    token(42161, '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', 'USDC.e', 'Bridged USDC', 6, ['stable']),
    token(42161, '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', 'DAI', 'Dai Stablecoin', 18, ['stable']),
    token(42161, '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', 'WBTC', 'Wrapped BTC', 8, ['wrapped']),
    token(42161, '0x912CE59144191C1204E64559FE8253a0e49E6548', 'ARB', 'Arbitrum', 18, ['governance']),
    token(42161, '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4', 'LINK', 'ChainLink Token', 18, []),
  ],
  10: [
    native(10, 'ETH', 'Ether'),
    token(10, '0x4200000000000000000000000000000000000006', 'WETH', 'Wrapped Ether', 18, ['wrapped']),
    token(10, '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', 'USDC', 'USDCoin', 6, ['stable']),
    token(10, '0x7F5c764cBc14f9669B88837ca1490cCa17c31607', 'USDC.e', 'Bridged USDC', 6, ['stable']),
    token(10, '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', 'USDT', 'Tether USD', 6, ['stable']),
    token(10, '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', 'DAI', 'Dai Stablecoin', 18, ['stable']),
    token(10, '0x68f180fcCe6836688e9084f035309E29Bf0A2095', 'WBTC', 'Wrapped BTC', 8, ['wrapped']),
    token(10, '0x4200000000000000000000000000000000000042', 'OP', 'Optimism', 18, ['governance']),
    token(10, '0x350a791Bfc2C21F9Ed5d10980Dad2e2638ffa7f6', 'LINK', 'ChainLink Token', 18, []),
  ],
  8453: [
    native(8453, 'ETH', 'Ether'),
    token(8453, '0x4200000000000000000000000000000000000006', 'WETH', 'Wrapped Ether', 18, ['wrapped']),
    token(8453, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'USDC', 'USD Coin', 6, ['stable']),
    token(8453, '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', 'USDT', 'Tether USD', 6, ['stable']),
    token(8453, '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', 'DAI', 'Dai Stablecoin', 18, ['stable']),
    token(8453, '0xc3De830EA07524a0761646a6a4e4be0e114a3C83', 'UNI', 'Uniswap', 18, ['governance']),
  ],
  43114: [
    native(43114, 'AVAX', 'Avalanche'),
    token(43114, '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', 'WAVAX', 'Wrapped AVAX', 18, ['wrapped']),
    token(43114, '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', 'USDC', 'USDC Token', 6, ['stable']),
    token(43114, '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', 'USDT', 'Tether USD', 6, ['stable']),
    token(43114, '0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB', 'WETH', 'Wrapped Ether', 18, ['wrapped']),
    token(43114, '0x50b7545627a5162F82A992c33b87aDc75187B218', 'WBTC', 'Wrapped BTC', 8, ['wrapped']),
    token(43114, '0x5947BB275c521040051D82396192181b413227A3', 'LINK', 'ChainLink Token', 18, []),
  ],
};

function readCustom(): CustomTokens {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CustomTokens) : {};
  } catch {
    return {};
  }
}

let version = 0;
const listeners = new Set<() => void>();

function emit(): void {
  version += 1;
  listeners.forEach((listener) => listener());
}

function writeCustom(next: CustomTokens): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // sem persistência: vale só na sessão
    }
  }
  emit();
}

/** Tokens do KuramaChain que dependem dos contratos configurados. */
function kuramaContractTokens(chainId: number): TokenConfig[] {
  const out: TokenConfig[] = [];
  const kur = contractAddress(chainId, 'token');
  if (kur) {
    out.push(token(chainId, kur, 'KUR', 'Kurama Token', 18, ['base'], true));
  }
  const wkur = contractAddress(chainId, 'wrappedNative');
  if (wkur) {
    out.push(token(chainId, wkur, 'WKUR', 'Wrapped Kurama', 18, ['wrapped'], true));
  }
  return out;
}

function dedupe(tokens: TokenConfig[]): TokenConfig[] {
  const seen = new Set<string>();
  const out: TokenConfig[] = [];
  for (const item of tokens) {
    const key = item.address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** Tokens de uma rede: nativos + verificados + contratos + customizados. */
export function tokensForChain(chainId: number): TokenConfig[] {
  const builtin = BUILTIN[chainId] ?? [native(chainId, getChain(chainId)?.native.symbol ?? 'ETH', getChain(chainId)?.native.name ?? 'Native')];
  const dynamic = chainId === KURAMA_CHAIN_ID ? kuramaContractTokens(chainId) : [];
  const custom = readCustom()[String(chainId)] ?? [];
  return dedupe([...builtin, ...dynamic, ...custom.map((item) => ({ ...item, verified: false, tags: ['custom' as const] }))]);
}

/** Busca por endereço (case-insensitive) na rede. */
export function findToken(chainId: number, address: string): TokenConfig | undefined {
  return tokensForChain(chainId).find((item) => sameAddress(item.address, address));
}

/** `TokenMeta` a partir do registro (ou de um endereço desconhecido). */
export function tokenMeta(chainId: number, address: string): TokenMeta {
  const known = findToken(chainId, address);
  return {
    address: known?.address ?? address,
    symbol: known?.symbol ?? '?',
    name: known?.name ?? 'Token desconhecido',
    decimals: known?.decimals ?? 18,
  };
}

export function isNativeToken(address: string): boolean {
  return sameAddress(address, NATIVE_TOKEN);
}

export function addCustomToken(
  chainId: number,
  input: { address: string; symbol: string; name?: string; decimals: number },
): void {
  if (!isAddress(input.address)) throw new Error('Endereço de token inválido');
  if (isNativeToken(input.address)) throw new Error('O ativo nativo já está na lista');
  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol) throw new Error('Informe o símbolo do token');
  if (!Number.isInteger(input.decimals) || input.decimals < 0 || input.decimals > 36) {
    throw new Error('Decimais inválidos');
  }
  const all = readCustom();
  const list = all[String(chainId)] ?? [];
  if (list.some((item) => sameAddress(item.address, input.address))) {
    throw new Error('Esse token já foi adicionado');
  }
  list.push({
    chainId,
    address: input.address,
    symbol,
    name: (input.name ?? symbol).trim() || symbol,
    decimals: input.decimals,
    tags: ['custom'],
    verified: false,
  });
  writeCustom({ ...all, [String(chainId)]: list });
}

export function removeCustomToken(chainId: number, address: string): void {
  const all = readCustom();
  const list = (all[String(chainId)] ?? []).filter((item) => !sameAddress(item.address, address));
  writeCustom({ ...all, [String(chainId)]: list });
}

export function subscribeTokens(listener: () => void): () => void {
  const offTokens = (() => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  })();
  const offContracts = subscribeContracts(listener);
  return () => {
    offTokens();
    offContracts();
  };
}

/** Versão combinada (tokens + contratos) para `useSyncExternalStore`. */
export function tokensVersion(): number {
  return version + contractsVersion();
}
