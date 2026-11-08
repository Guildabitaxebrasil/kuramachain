import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { newWallet, restoreWallet } from '../api/client';
import { getStoredWallets, saveWallet as persistWallet, removeWallet as removeStoredWallet, type StoredWallet } from '../utils/walletStorage';

/** Carteira conectada: só dados públicos — a chave privada fica no nó. */
interface ConnectedWallet {
  address: string;
  public_key: string;
  label: string;
}

interface WalletContextType {
  /** Carteira atualmente conectada */
  wallet: ConnectedWallet | null;
  /** Lista de carteiras salvas no localStorage */
  savedWallets: StoredWallet[];
  /** Conecta a uma carteira existente (endereço + chave pública) */
  connect: (address: string, publicKey?: string, label?: string) => void;
  /**
   * Cria e conecta uma nova carteira via API.
   * Retorna a frase de recuperação (24 palavras), que existe só em memória:
   * o chamador deve exibi-la uma vez e descartá-la.
   */
  createAndConnect: () => Promise<string | null>;
  /**
   * Recupera uma carteira a partir da frase de 24 palavras e conecta.
   * A frase não é armazenada em lugar nenhum.
   * Retorna o endereço restaurado.
   */
  restoreAndConnect: (mnemonic: string) => Promise<string>;
  /** Desconecta a carteira atual */
  disconnect: () => void;
  /** Remove uma carteira salva */
  removeWallet: (address: string) => void;
  /** Se está conectado */
  isConnected: boolean;
  /** Endereço da carteira conectada (atalho) */
  currentAddress: string | null;
}

const WalletContext = createContext<WalletContextType | null>(null);

const STORAGE_KEY = 'kurama_connected_wallet';

/**
 * Lê a carteira conectada. Versões antigas gravavam a chave privada junto;
 * ela é removida na hora, para não ficar no navegador.
 */
function loadConnectedWallet(): ConnectedWallet | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConnectedWallet & { private_key_pem?: string };
    if (parsed && 'private_key_pem' in parsed) {
      const { private_key_pem, ...rest } = parsed;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
      return rest;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveConnectedWallet(wallet: ConnectedWallet | null): void {
  if (wallet) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(wallet));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<ConnectedWallet | null>(loadConnectedWallet);
  const [savedWallets, setSavedWallets] = useState<StoredWallet[]>(getStoredWallets);

  // Mantém savedWallets sincronizado
  useEffect(() => {
    setSavedWallets(getStoredWallets());
  }, []);

  const refreshSavedWallets = useCallback(() => {
    setSavedWallets(getStoredWallets());
  }, []);

  const connect = useCallback((address: string, publicKey = '', label?: string) => {
    const connected: ConnectedWallet = {
      address,
      public_key: publicKey,
      label: label || `Carteira ${address.slice(0, 8)}...`,
    };
    setWallet(connected);
    saveConnectedWallet(connected);
    refreshSavedWallets();
  }, [refreshSavedWallets]);

  const disconnect = useCallback(() => {
    setWallet(null);
    saveConnectedWallet(null);
  }, []);

  const removeWallet = useCallback((address: string) => {
    removeStoredWallet(address);
    if (wallet?.address === address) {
      disconnect();
    }
    refreshSavedWallets();
  }, [wallet, disconnect, refreshSavedWallets]);

  const createAndConnect = useCallback(async (): Promise<string | null> => {
    try {
      const w = await newWallet();
      const label = `Carteira ${w.address.slice(0, 8)}...`;
      // Só o endereço é persistido: a chave privada fica no cofre do nó.
      persistWallet({
        address: w.address,
        public_key: w.public_key_pem || '',
        label,
        created_at: Date.now(),
      });
      connect(w.address, w.public_key_pem, label);
      return w.mnemonic ?? null;
    } catch (err: any) {
      throw new Error(err?.response?.data?.error || err.message || 'Erro ao criar carteira');
    }
  }, [connect]);

  const restoreAndConnect = useCallback(async (mnemonic: string): Promise<string> => {
    try {
      const w = await restoreWallet(mnemonic);
      const label = `Carteira ${w.address.slice(0, 8)}...`;
      persistWallet({
        address: w.address,
        public_key: w.public_key_pem || '',
        label,
        created_at: Date.now(),
      });
      connect(w.address, w.public_key_pem, label);
      return w.address;
    } catch (err: any) {
      throw new Error(err?.response?.data?.error || err.message || 'Erro ao restaurar carteira');
    }
  }, [connect]);

  return (
    <WalletContext.Provider
      value={{
        wallet,
        savedWallets,
        connect,
        createAndConnect,
        restoreAndConnect,
        disconnect,
        removeWallet,
        isConnected: !!wallet,
        currentAddress: wallet?.address || null,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextType {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within a WalletProvider');
  return ctx;
}
