import axios from 'axios';
import type {
  Block, Transaction, WalletInfo, Stats, MempoolStats,
  ChartDataPoint, NodeInfo, NodesResponse, SearchResult, ChainResponse,
  HealthResponse, MineResponse, BalanceResponse, SupplyResponse
} from './types';

const api = axios.create({
  baseURL: '/',
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

async function fetchData<T>(url: string, params?: Record<string, any>): Promise<T> {
  const res = await api.get<T>(url, { params });
  return res.data;
}

async function postData<T>(url: string, body: any): Promise<T> {
  const res = await api.post<T>(url, body);
  return res.data;
}

// Chain endpoints
export const getChain = () => fetchData<ChainResponse>('/chain');
export const getBlocksSince = (index: number) => fetchData<ChainResponse>(`/api/chain/since/${index}`);
export const getBlockByIdentifier = (id: string | number) => fetchData<Block>(`/api/blocks/${id}`);
export const getAllBlocks = () => fetchData<Block[]>('/api/blocks/all');

// Transaction endpoints
export const getPendingTransactions = () => fetchData<{ transactions: Transaction[] }>('/transactions/pending');
export const getAllTransactions = (params?: { page?: number; per_page?: number; sender?: string; receiver?: string; min_amount?: number; max_amount?: number; block?: number }) =>
  fetchData<{ transactions: Transaction[]; total: number; page: number; per_page: number; total_pages: number }>('/api/transactions', params);
export const createTransaction = (data: { sender: string; receiver: string; amount: number; fee?: number; signature?: string; sender_address?: string; timestamp?: number }) =>
  postData<{ message: string; index: number; transaction: Transaction }>('/transactions/new', data);

// Mining (POST para prevenir CSRF)
export const mineBlock = (miner_address?: string) =>
  postData<MineResponse>('/mine', miner_address ? { miner_address } : {});

// Wallet (POST para prevenir CSRF)
export const newWallet = () => postData<WalletInfo>('/wallet/new', {});
/** Recupera uma carteira existente a partir da frase de recuperação (24 palavras). */
export const restoreWallet = (mnemonic: string) =>
  postData<WalletInfo>('/wallet/restore', { mnemonic });
export const getBalance = (address: string) => fetchData<BalanceResponse>(`/balance/${address}`);

// Network
export const registerNode = (url: string) => postData<{ message: string; total_nodes: number }>('/nodes/register', { node_url: url });
export const resolveConsensus = () => fetchData<{ message: string; chain_replaced: boolean; new_length: number }>('/nodes/resolve');
export const getNodes = () => fetchData<NodesResponse>('/api/nodes');
export const syncNodes = () => postData<{ message: string; chain_replaced: boolean }>('/api/nodes/sync', {});

// Transação assinada no servidor: a UI manda só o endereço de origem.
export const createSignedTransaction = (data: { from_address?: string; private_key_pem?: string; mnemonic?: string; receiver: string; amount: number; fee?: number }) =>
  postData<{
    message: string;
    transaction: Transaction;
    transaction_index: number;
    sender_address: string;
    sender_balance: number;
    /** Hash da transferência que creditou o destino na EVM (destino 0x...). */
    evm_tx_hash?: string | null;
    evm_credited_wei?: number;
    evm_balance?: number | null;
  }>('/api/transactions/create-signed', data);

// Stats & Explorer
export const getStats = () => fetchData<Stats>('/stats');
export const getSupply = () => fetchData<SupplyResponse>('/api/supply');
export const getChartData = (limit?: number) => fetchData<ChartDataPoint[]>('/api/chart', { limit });
export const getMempoolStats = () => fetchData<MempoolStats>('/api/mempool');
/**
 * Busca unificada.
 *
 * O backend responde um único resultado no formato `{type, data, url}`,
 * mas a barra de busca trabalha com listas (`blocks`, `transactions`,
 * `addresses`). Sem esta normalização o dropdown ficava sempre em
 * "Nenhum resultado encontrado" e não dava para clicar no endereço.
 */
export const search = async (q: string): Promise<SearchResult> => {
  const res = await fetchData<any>('/api/search', { q });
  if (res && (Array.isArray(res.blocks) || Array.isArray(res.addresses))) {
    return res as SearchResult;
  }
  const empty: SearchResult = { blocks: [], transactions: [], addresses: [] };
  if (res?.type === 'address' && res.data?.address) {
    return { ...empty, addresses: [res.data.address] };
  }
  if (res?.type === 'block' && res.data) {
    return { ...empty, blocks: [res.data] };
  }
  if (res?.type === 'transaction' && res.data) {
    return { ...empty, transactions: [res.data] };
  }
  return empty;
};
export const getHealth = () => fetchData<HealthResponse>('/api/health');
export const validateChain = () => fetchData<{ valid: boolean; errors: string[] }>('/validate');
