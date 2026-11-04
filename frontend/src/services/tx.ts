/**
 * Envio de transação assinada pela wallet, com troca de rede e recibo.
 *
 * Nada de chave privada no frontend: a wallet assina e envia a tx crua. O helper
 * garante que a rede certa está selecionada antes de pedir a assinatura e só
 * devolve sucesso quando o recibo confirma `0x1`.
 */
import {
  ensureChain,
  getEvmProvider,
  kuramaChainParams,
  sendWalletTransaction,
  waitForTransactionReceipt,
  type WalletTransactionRequest,
} from '../api/evmWallet';
import { KURAMA_CHAIN_ID, getChain, rpcUrlsForChain } from '../chains/chains';
import { invalidateRpcCache } from './rpc';

/** Troca (ou adiciona) a rede na wallet antes de assinar. */
export async function ensureWalletChain(chainId: number): Promise<void> {
  if (!getEvmProvider()) throw new Error('Carteira EVM não encontrada no navegador');
  if (chainId === KURAMA_CHAIN_ID) {
    await ensureChain(chainId, kuramaChainParams());
    return;
  }
  const chain = getChain(chainId);
  if (!chain) throw new Error(`Rede ${chainId} desconhecida`);
  await ensureChain(chainId, {
    chainName: chain.name,
    nativeCurrency: chain.native,
    rpcUrls: rpcUrlsForChain(chainId),
    blockExplorerUrls: [chain.explorer.baseUrl],
  });
}

export interface SentTransaction {
  hash: string;
  status: 'confirmed' | 'failed' | 'pending';
}

/** Assina, envia e espera o recibo. */
export async function sendAndWait(
  chainId: number,
  tx: WalletTransactionRequest,
  timeoutMs = 120_000,
): Promise<SentTransaction> {
  await ensureWalletChain(chainId);
  const hash = await sendWalletTransaction(tx);
  const receipt = await waitForTransactionReceipt(hash, timeoutMs);
  invalidateRpcCache();
  return {
    hash,
    status: !receipt ? 'pending' : receipt.status === '0x1' ? 'confirmed' : 'failed',
  };
}
