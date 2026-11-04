/**
 * Carteira EVM do DeFi.
 *
 * Diferente do `WalletContext` (carteira Base58 da KuramaChain usada pelo
 * explorer), este hook expõe a conta EIP-1193 conectada — a que assina swaps,
 * liquidez, staking, lending e bridge.
 */
import { useNetwork } from '../context/NetworkContext';

export function useWallet() {
  const { account, walletChainId, chainId, connecting, connect, disconnect, switchNetwork } =
    useNetwork();
  return {
    account,
    walletChainId,
    chainId,
    connecting,
    connect,
    disconnect,
    switchNetwork,
    connected: !!account,
    wrongNetwork: account !== null && walletChainId !== null && walletChainId !== chainId,
  };
}
