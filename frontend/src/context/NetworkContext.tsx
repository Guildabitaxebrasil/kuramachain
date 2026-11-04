/**
 * Rede + carteira EVM do terminal DeFi.
 *
 * - A rede selecionada é local (`localStorage`), então trocar de rede não
 *   depende da wallet e não derruba o estado do app.
 * - A leitura de dados usa JSON-RPC (com fallback); a wallet só entra quando o
 *   usuário conecta ou assina algo.
 * - `walletChainId !== chainId` é exposto para a UI avisar “rede errada”.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { ChainConfig, ContractEntry, ContractKey, TokenConfig } from '../types/defi';
import { CHAINS, KURAMA_CHAIN_ID, getChain } from '../chains/chains';
import { getContracts, subscribeContracts, contractsVersion } from '../contracts/registry';
import { subscribeTokens, tokensForChain, tokensVersion } from '../tokens/registry';
import {
  getRpcHealth,
  probeChain,
  rpcHealthVersion,
  subscribeRpc,
} from '../services/rpc';
import {
  getEvmProvider,
  requestAccounts,
  type Eip1193Provider,
} from '../api/evmWallet';
import { ensureWalletChain } from '../services/tx';

const CHAIN_KEY = 'kurama.defi.chain';

function storedChain(): number {
  if (typeof window === 'undefined') return KURAMA_CHAIN_ID;
  const raw = window.localStorage.getItem(CHAIN_KEY);
  const parsed = raw ? Number(raw) : NaN;
  return getChain(parsed) ? parsed : KURAMA_CHAIN_ID;
}

interface NetworkContextValue {
  chainId: number;
  chain: ChainConfig;
  chains: ChainConfig[];
  setChainId: (chainId: number) => void;
  switchNetwork: (chainId: number) => Promise<void>;
  tokens: TokenConfig[];
  contracts: Record<ContractKey, ContractEntry>;
  rpcStatus: ReturnType<typeof getRpcHealth>;
  account: string | null;
  walletChainId: number | null;
  connecting: boolean;
  connect: () => Promise<string | null>;
  disconnect: () => void;
  refreshRpc: () => void;
}

const NetworkContext = createContext<NetworkContextValue | null>(null);

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [chainId, setChainIdState] = useState<number>(storedChain);
  const [account, setAccount] = useState<string | null>(null);
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const providerRef = useRef<Eip1193Provider | null>(null);

  const tokensVersionValue = useSyncExternalStore(subscribeTokens, tokensVersion, tokensVersion);
  const contractsVersionValue = useSyncExternalStore(
    subscribeContracts,
    contractsVersion,
    contractsVersion,
  );
  const healthVersion = useSyncExternalStore(subscribeRpc, rpcHealthVersion, rpcHealthVersion);

  const tokens = useMemo(
    () => tokensForChain(chainId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chainId, tokensVersionValue],
  );
  const contracts = useMemo(
    () => getContracts(chainId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chainId, contractsVersionValue],
  );
  const rpcStatus = useMemo(
    () => getRpcHealth(chainId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chainId, healthVersion],
  );

  const setChainId = useCallback((next: number) => {
    if (!getChain(next)) return;
    setChainIdState(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(CHAIN_KEY, String(next));
    }
  }, []);

  const refreshRpc = useCallback(() => {
    void probeChain(chainId);
  }, [chainId]);

  // Sonda o RPC da rede ativa (30s) e ao trocar de rede.
  useEffect(() => {
    void probeChain(chainId);
    const timer = window.setInterval(() => {
      void probeChain(chainId);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [chainId]);

  // Descobre a carteira (EIP-6963) e acompanha conta/rede, sem abrir popup.
  useEffect(() => {
    let disposed = false;

    const sync = async () => {
      const provider = getEvmProvider();
      providerRef.current = provider;
      if (!provider) {
        setAccount(null);
        setWalletChainId(null);
        return;
      }
      try {
        const accounts = (await provider.request({ method: 'eth_accounts' })) as string[];
        if (!disposed) setAccount(Array.isArray(accounts) && accounts.length ? accounts[0] : null);
      } catch {
        if (!disposed) setAccount(null);
      }
      try {
        const hex = (await provider.request({ method: 'eth_chainId' })) as string;
        if (!disposed) setWalletChainId(Number.parseInt(hex, 16));
      } catch {
        if (!disposed) setWalletChainId(null);
      }
    };

    void sync();

    const provider = providerRef.current;
    const onAccounts = (...args: unknown[]) => {
      const list = (args[0] as string[]) ?? [];
      setAccount(list.length ? list[0] : null);
    };
    const onChain = (...args: unknown[]) => {
      const hex = (args[0] as string) ?? '0x0';
      setWalletChainId(Number.parseInt(hex, 16));
    };
    provider?.on?.('accountsChanged', onAccounts);
    provider?.on?.('chainChanged', onChain);

    const onAnnounce = () => void sync();
    window.addEventListener('eip6963:announceProvider', onAnnounce);

    return () => {
      disposed = true;
      provider?.removeListener?.('accountsChanged', onAccounts);
      provider?.removeListener?.('chainChanged', onChain);
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
    };
  }, []);

  const connect = useCallback(async (): Promise<string | null> => {
    setConnecting(true);
    try {
      const accounts = await requestAccounts();
      const next = accounts.length ? accounts[0] : null;
      setAccount(next);
      const provider = getEvmProvider();
      providerRef.current = provider;
      if (provider) {
        try {
          const hex = (await provider.request({ method: 'eth_chainId' })) as string;
          setWalletChainId(Number.parseInt(hex, 16));
        } catch {
          setWalletChainId(null);
        }
      }
      return next;
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    // A wallet não permite revogar a permissão pelo dApp; só soltamos o estado.
    setAccount(null);
    setWalletChainId(null);
  }, []);

  const switchNetwork = useCallback(
    async (next: number) => {
      setChainId(next);
      if (account) await ensureWalletChain(next);
    },
    [account, setChainId],
  );

  const chain = getChain(chainId) ?? CHAINS[0];

  const value = useMemo<NetworkContextValue>(
    () => ({
      chainId,
      chain,
      chains: CHAINS,
      setChainId,
      switchNetwork,
      tokens,
      contracts,
      rpcStatus,
      account,
      walletChainId,
      connecting,
      connect,
      disconnect,
      refreshRpc,
    }),
    [
      chainId,
      chain,
      setChainId,
      switchNetwork,
      tokens,
      contracts,
      rpcStatus,
      account,
      walletChainId,
      connecting,
      connect,
      disconnect,
      refreshRpc,
    ],
  );

  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>;
}

export function useNetwork(): NetworkContextValue {
  const ctx = useContext(NetworkContext);
  if (!ctx) throw new Error('useNetwork precisa estar dentro de <NetworkProvider>');
  return ctx;
}
