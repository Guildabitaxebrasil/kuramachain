/**
 * Registro de contratos DeFi (address, chainId, version, enabled).
 *
 * Nenhum endereço é inventado: o valor vem de `VITE_*` (build) ou do que o
 * usuário salva na UI (`localStorage`). Contratos Uniswap V3 entram apenas nas
 * redes onde o endereço é comprovado (`api/uniswap.ts` + factory canônica).
 */
import type { ContractEntry, ContractKey } from '../types/defi';
import { getChain } from '../chains/chains';
import { UNISWAP } from '../api/uniswap';
import { isAddress } from '../abi/coders';

const STORAGE_KEY = 'kurama.contracts.v1';

type Overrides = Record<string, Partial<Record<ContractKey, string>>>;

interface ContractMeta {
  label: string;
  version: string;
  env: string;
  /** Só faz sentido na KuramaChain (contratos próprios). */
  kuramaOnly?: boolean;
}

const META: Record<ContractKey, ContractMeta> = {
  token: { label: 'KurToken (ERC-20 KUR)', version: '1.0.0', env: 'VITE_KUR_TOKEN', kuramaOnly: true },
  wrappedNative: { label: 'WKUR (wrapped nativo)', version: '1.0.0', env: 'VITE_KUR_WKUR', kuramaOnly: true },
  factory: { label: 'KurFactory', version: '1.0.0', env: 'VITE_KUR_FACTORY', kuramaOnly: true },
  router: { label: 'KurRouter', version: '1.0.0', env: 'VITE_KUR_ROUTER', kuramaOnly: true },
  oracle: { label: 'KurOracle (TWAP)', version: '1.0.0', env: 'VITE_KUR_ORACLE', kuramaOnly: true },
  priceFeed: { label: 'KurPriceFeed', version: '1.0.0', env: 'VITE_KUR_PRICE_FEED', kuramaOnly: true },
  priceOracle: { label: 'KurPriceOracle (lending)', version: '1.0.0', env: 'VITE_KUR_PRICE_ORACLE', kuramaOnly: true },
  staking: { label: 'KurStaking', version: '1.0.0', env: 'VITE_KUR_STAKING', kuramaOnly: true },
  lendingPool: { label: 'KurLendingPool', version: '1.0.0', env: 'VITE_KUR_LENDING_POOL', kuramaOnly: true },
  bridge: { label: 'KurBridge', version: '1.0.0', env: 'VITE_KUR_BRIDGE', kuramaOnly: true },
  wrappedToken: { label: 'KurWrappedToken', version: '1.0.0', env: 'VITE_KUR_WRAPPED_TOKEN', kuramaOnly: true },
  uniswapFactory: { label: 'UniswapV3Factory', version: 'canonical', env: 'VITE_UNISWAP_FACTORY' },
  uniswapRouter: { label: 'SwapRouter02', version: 'Polygon', env: 'VITE_UNISWAP_ROUTER' },
  uniswapQuoter: { label: 'QuoterV2', version: 'Polygon', env: 'VITE_UNISWAP_QUOTER' },
};

export const CONTRACT_KEYS = Object.keys(META) as ContractKey[];

export function contractMeta(key: ContractKey): ContractMeta {
  return META[key];
}

function envValue(name: string): string {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const value = env?.[name];
  return typeof value === 'string' ? value.trim() : '';
}

function readOverrides(): Overrides {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Overrides) : {};
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

function writeOverrides(next: Overrides): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // localStorage indisponível: o endereço vale só até recarregar.
    }
  }
  emit();
}

/** Endereços padrão que o projeto já conhece (não vêm de env). */
function defaultAddress(chainId: number, key: ContractKey): string {
  const chain = getChain(chainId);
  if (key === 'uniswapFactory' && chain?.uniswapV3Factory) return chain.uniswapV3Factory;
  if (chainId === 137) {
    if (key === 'uniswapRouter') return UNISWAP.router02;
    if (key === 'uniswapQuoter') return UNISWAP.quoterV2;
  }
  return '';
}

/** Snapshot dos contratos de uma rede (todas as chaves, mesmo desabilitadas). */
export function getContracts(chainId: number): Record<ContractKey, ContractEntry> {
  const overrides = readOverrides()[String(chainId)] ?? {};
  const out = {} as Record<ContractKey, ContractEntry>;
  for (const key of CONTRACT_KEYS) {
    const meta = META[key];
    const fromEnv = envValue(meta.env);
    const fromLocal = (overrides[key] ?? '').trim();
    const fallback = defaultAddress(chainId, key);
    const address = fromLocal || fromEnv || fallback;
    out[key] = {
      key,
      label: meta.label,
      address,
      chainId,
      version: meta.version,
      enabled: isAddress(address),
      source: fromLocal ? 'local' : fromEnv ? 'env' : 'default',
    };
  }
  return out;
}

export function contractEntry(chainId: number, key: ContractKey): ContractEntry {
  return getContracts(chainId)[key];
}

/** Endereço utilizável ou `''` quando não configurado. */
export function contractAddress(chainId: number, key: ContractKey): string {
  const entry = contractEntry(chainId, key);
  return entry.enabled ? entry.address : '';
}

export function isContractConfigured(chainId: number, key: ContractKey): boolean {
  return contractEntry(chainId, key).enabled;
}

/** Salva (ou remove, com string vazia) o endereço de um contrato. */
export function setContractAddress(chainId: number, key: ContractKey, address: string): void {
  const clean = address.trim();
  if (clean && !isAddress(clean)) {
    throw new Error('Endereço inválido — use 0x seguido de 40 caracteres hexadecimais');
  }
  const overrides = readOverrides();
  const perChain = { ...(overrides[String(chainId)] ?? {}) };
  if (clean) {
    perChain[key] = clean;
  } else {
    delete perChain[key];
  }
  writeOverrides({ ...overrides, [String(chainId)]: perChain });
}

export function subscribeContracts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function contractsVersion(): number {
  return version;
}
