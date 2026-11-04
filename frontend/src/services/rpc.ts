/**
 * Cliente JSON-RPC multi-chain da DeFi.
 *
 * - **Fallback**: tenta o último RPC que funcionou, depois a lista da rede.
 * - **Health**: mede latência e guarda 🟢 connected / 🟡 slow / 🔴 offline.
 * - **Cache**: `eth_call` é memoizado por alguns segundos (evita refetch a cada
 *   render); nada de cache para `eth_getLogs`/recibos.
 * - **Timeout**: toda requisição tem `AbortController` — RPC pendurado não trava
 *   a UI.
 */
import type { RpcHealth } from '../types/defi';
import { rpcUrlsForChain } from '../chains/chains';
import { RpcError } from '../api/evmWallet';
import { decodeAddress, decodeInt, decodeTokenString, decodeUint, isAddress } from '../abi/coders';

const DEFAULT_TIMEOUT = 10_000;
const SLOW_THRESHOLD = 2_500;
const CACHE_LIMIT = 600;

interface CacheEntry {
  expires: number;
  value: unknown;
}

const cache = new Map<string, CacheEntry>();
const healthByChain = new Map<number, RpcHealth>();
const preferredUrl = new Map<number, string>();
const listeners = new Set<() => void>();

let version = 0;

function emit(): void {
  version += 1;
  listeners.forEach((listener) => listener());
}

function emptyHealth(chainId: number): RpcHealth {
  return {
    chainId,
    status: 'unknown',
    latencyMs: null,
    url: '',
    lastChecked: 0,
    error: null,
  };
}

export function getRpcHealth(chainId: number): RpcHealth {
  return healthByChain.get(chainId) ?? emptyHealth(chainId);
}

export function subscribeRpc(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function rpcHealthVersion(): number {
  return version;
}

function setHealth(chainId: number, patch: Partial<RpcHealth>): void {
  const current = healthByChain.get(chainId) ?? emptyHealth(chainId);
  healthByChain.set(chainId, { ...current, ...patch, chainId, lastChecked: Date.now() });
  emit();
}

function cacheGet<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expires < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value as T;
}

function cacheSet(key: string, value: unknown, ttlMs: number): void {
  if (ttlMs <= 0) return;
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { expires: Date.now() + ttlMs, value });
}

export interface RpcCallOptions {
  /** TTL do cache (ms). `0` desliga o cache. */
  cacheMs?: number;
  timeoutMs?: number;
}

async function post<T>(
  url: string,
  method: string,
  params: unknown[],
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = (await response.json()) as {
      result?: T;
      error?: { code: number; message: string };
    };
    if (payload.error) throw new RpcError(payload.error.message, payload.error.code);
    return payload.result as T;
  } finally {
    clearTimeout(timer);
  }
}

function orderedUrls(chainId: number): string[] {
  const urls = rpcUrlsForChain(chainId);
  const preferred = preferredUrl.get(chainId);
  return preferred ? [preferred, ...urls.filter((url) => url !== preferred)] : urls;
}

/**
 * Chamada JSON-RPC com fallback entre os RPCs da rede.
 *
 * Erros JSON-RPC (revert) são definitivos: rotacionar de RPC só faria o usuário
 * esperar três timeouts para o mesmo erro.
 */
export async function rpc<T = unknown>(
  chainId: number,
  method: string,
  params: unknown[] = [],
  options: RpcCallOptions = {},
): Promise<T> {
  const cacheKey = `${chainId}|${method}|${JSON.stringify(params)}`;
  const cached = options.cacheMs ? cacheGet<T>(cacheKey) : undefined;
  if (cached !== undefined) return cached;

  const urls = orderedUrls(chainId);
  if (!urls.length) throw new Error(`Nenhum RPC configurado para a chain ${chainId}`);

  let lastError: unknown = null;
  for (const url of urls) {
    const started = performance.now();
    try {
      const result = await post<T>(url, method, params, options.timeoutMs ?? DEFAULT_TIMEOUT);
      const latency = Math.round(performance.now() - started);
      preferredUrl.set(chainId, url);
      setHealth(chainId, {
        status: latency > SLOW_THRESHOLD ? 'slow' : 'connected',
        latencyMs: latency,
        url,
        error: null,
      });
      if (options.cacheMs) cacheSet(cacheKey, result, options.cacheMs);
      return result;
    } catch (err) {
      if (err instanceof RpcError) {
        // Revert do contrato: o resultado seria o mesmo em qualquer RPC.
        setHealth(chainId, { status: 'connected', url });
        throw err;
      }
      lastError = err;
    }
  }

  setHealth(chainId, {
    status: 'offline',
    error: lastError instanceof Error ? lastError.message : 'RPC indisponível',
  });
  throw new Error(
    `RPC da chain ${chainId} indisponível: ${
      lastError instanceof Error ? lastError.message : 'erro desconhecido'
    }`,
  );
}

/** `eth_call` cru (aceita `latest`); retorna `0x` quando não há contrato. */
export async function ethCall(
  chainId: number,
  to: string,
  data: string,
  cacheMs = 6_000,
): Promise<string> {
  if (!isAddress(to)) throw new Error(`Contrato inválido: ${to}`);
  const result = await rpc<string>(
    chainId,
    'eth_call',
    [{ to, data }, 'latest'],
    { cacheMs, timeoutMs: 12_000 },
  );
  return result ?? '0x';
}

export async function readUint(
  chainId: number,
  to: string,
  data: string,
  index = 0,
  cacheMs = 6_000,
): Promise<bigint> {
  return decodeUint(await ethCall(chainId, to, data, cacheMs), index);
}

export async function readInt(
  chainId: number,
  to: string,
  data: string,
  index = 0,
  cacheMs = 6_000,
): Promise<bigint> {
  return decodeInt(await ethCall(chainId, to, data, cacheMs), index);
}

export async function readAddress(
  chainId: number,
  to: string,
  data: string,
  cacheMs = 6_000,
): Promise<string> {
  return decodeAddress(await ethCall(chainId, to, data, cacheMs));
}

export async function readString(
  chainId: number,
  to: string,
  data: string,
  cacheMs = 30_000,
): Promise<string> {
  const raw = await ethCall(chainId, to, data, cacheMs);
  if (!raw || raw === '0x') return '';
  return decodeTokenString(raw);
}

export async function getNativeBalance(chainId: number, address: string): Promise<bigint> {
  const hex = await rpc<string>(chainId, 'eth_getBalance', [address, 'latest'], { cacheMs: 4_000 });
  return BigInt(hex ?? '0x0');
}

export async function getBlockNumber(chainId: number): Promise<number> {
  const hex = await rpc<string>(chainId, 'eth_blockNumber', [], { cacheMs: 1_500 });
  return Number.parseInt(hex ?? '0x0', 16);
}

/** Verifica se o RPC responde e atualiza o status exibido na UI. */
export async function probeChain(chainId: number): Promise<RpcHealth> {
  const started = performance.now();
  try {
    const hex = await rpc<string>(chainId, 'eth_chainId', [], { timeoutMs: 6_000 });
    const reported = Number.parseInt(hex ?? '0x0', 16);
    const latency = Math.round(performance.now() - started);
    const status = latency > SLOW_THRESHOLD ? 'slow' : 'connected';
    setHealth(chainId, {
      status,
      latencyMs: latency,
      url: preferredUrl.get(chainId) ?? '',
      error: reported === chainId ? null : `RPC respondeu chain ${reported}`,
    });
  } catch (err) {
    setHealth(chainId, {
      status: 'offline',
      latencyMs: null,
      error: err instanceof Error ? err.message : 'RPC indisponível',
    });
  }
  return getRpcHealth(chainId);
}

/** Limpa o cache de leitura (chamado depois de enviar uma transação). */
export function invalidateRpcCache(): void {
  cache.clear();
}

/** Estima gas para uma chamada (usa o `from` real, como a wallet faria). */
export async function estimateGas(
  chainId: number,
  from: string,
  tx: { to: string; data?: string; value?: string },
): Promise<bigint> {
  const hex = await rpc<string>(
    chainId,
    'eth_estimateGas',
    [{ from, to: tx.to, data: tx.data ?? '0x', ...(tx.value ? { value: tx.value } : {}) }],
    { timeoutMs: 12_000 },
  );
  return BigInt(hex ?? '0x0');
}

export { DEFAULT_TIMEOUT };
