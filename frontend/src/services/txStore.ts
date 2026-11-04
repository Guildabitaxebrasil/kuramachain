/**
 * Histórico de transações enviadas pela interface.
 *
 * O hash é gravado **antes** da confirmação (status `pending`) e atualizado com
 * o recibo real (`eth_getTransactionReceipt`). Nada é inventado: se o recibo não
 * chegar, a transação continua `pending`.
 *
 * A fonte é o próprio navegador (`localStorage`); não existe indexador de
 * histórico no nó para txs EVM por conta.
 */
import type { TxKind, TxRecord, TxStatus } from '../types/defi';
import { explorerTxUrl } from '../chains/chains';
import { rpc } from './rpc';

const STORAGE_KEY = 'kurama.txs.v1';
const MAX_PER_ACCOUNT = 200;

type Store = Record<string, TxRecord[]>;

const listeners = new Set<() => void>();
let version = 0;

function read(): Store {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

function write(store: Store): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      // sem persistência — mantém em memória via emit
    }
  }
  version += 1;
  listeners.forEach((listener) => listener());
}

function accountKey(chainId: number, account: string): string {
  return `${chainId}:${account.toLowerCase()}`;
}

export function listTransactions(chainId: number, account: string | null): TxRecord[] {
  if (!account) return [];
  return (read()[accountKey(chainId, account)] ?? []).slice().sort((a, b) => b.createdAt - a.createdAt);
}

export interface NewTransaction {
  hash: string;
  chainId: number;
  account: string;
  kind: TxKind;
  description: string;
  to?: string;
  contract?: string;
  tokenIn?: TxRecord['tokenIn'];
  tokenOut?: TxRecord['tokenOut'];
  amountIn?: string;
  amountOut?: string;
}

export function addTransaction(input: NewTransaction): TxRecord {
  const record: TxRecord = {
    hash: input.hash,
    chainId: input.chainId,
    kind: input.kind,
    status: 'pending',
    account: input.account,
    to: input.to,
    contract: input.contract,
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    amountIn: input.amountIn,
    amountOut: input.amountOut,
    description: input.description,
    explorerUrl: explorerTxUrl(input.chainId, input.hash),
    createdAt: Date.now(),
  };
  const store = read();
  const key = accountKey(input.chainId, input.account);
  const list = [record, ...(store[key] ?? []).filter((item) => item.hash !== input.hash)];
  store[key] = list.slice(0, MAX_PER_ACCOUNT);
  write(store);
  return record;
}

export function updateTransaction(
  chainId: number,
  account: string,
  hash: string,
  patch: Partial<TxRecord> & { status?: TxStatus },
): void {
  const store = read();
  const key = accountKey(chainId, account);
  const list = store[key];
  if (!list) return;
  const index = list.findIndex((item) => item.hash.toLowerCase() === hash.toLowerCase());
  if (index < 0) return;
  list[index] = { ...list[index], ...patch };
  store[key] = list;
  write(store);
}

export function removeTransaction(chainId: number, account: string, hash: string): void {
  const store = read();
  const key = accountKey(chainId, account);
  store[key] = (store[key] ?? []).filter((item) => item.hash.toLowerCase() !== hash.toLowerCase());
  write(store);
}

interface Receipt {
  status: string;
  blockNumber: string;
  gasUsed: string;
}

/** Consulta o recibo até confirmar (ou até o timeout). */
export async function pollReceipt(
  chainId: number,
  hash: string,
  timeoutMs = 120_000,
): Promise<Receipt | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const receipt = await rpc<Receipt | null>(
        chainId,
        'eth_getTransactionReceipt',
        [hash],
        { cacheMs: 0, timeoutMs: 8_000 },
      );
      if (receipt) return receipt;
    } catch {
      // RPC instável: tenta de novo no próximo ciclo.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_800));
  }
  return null;
}

/** Acompanha o recibo e atualiza o registro (pending → confirmed/failed). */
export async function trackTransaction(
  chainId: number,
  account: string,
  hash: string,
): Promise<TxStatus> {
  const receipt = await pollReceipt(chainId, hash);
  if (!receipt) return 'pending';
  const status: TxStatus = receipt.status === '0x1' ? 'confirmed' : 'failed';
  updateTransaction(chainId, account, hash, {
    status,
    blockNumber: Number.parseInt(receipt.blockNumber, 16),
    gasUsed: BigInt(receipt.gasUsed).toString(),
    confirmedAt: Date.now(),
    error: status === 'failed' ? 'A transação reverteu on-chain' : undefined,
  });
  return status;
}

export function subscribeTransactions(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function transactionsVersion(): number {
  return version;
}
