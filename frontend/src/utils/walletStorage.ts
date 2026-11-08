/**
 * Utilitário para armazenar carteiras no localStorage.
 * As carteiras ficam disponíveis entre sessões (persistência local).
 *
 * SEGURANÇA: aqui fica apenas o endereço (e a chave pública). A chave privada
 * nunca é gravada no navegador — ela fica no cofre do nó e quem assina as
 * transações é o servidor. Versões antigas gravavam a PEM neste storage; ela
 * é removida na primeira leitura (ver `getStoredWallets`).
 */

export interface StoredWallet {
  address: string;
  public_key: string;
  label: string;
  created_at: number;
  /** A carteira do cofre do nó pede senha para enviar. */
  has_password?: boolean;
}

const STORAGE_KEY = 'kurama_wallets';

/**
 * Remove chaves privadas que versões anteriores deixaram no navegador e
 * regrava o storage limpo. Devolve a lista já sem as chaves.
 */
function stripLegacyPrivateKeys(wallets: any[]): StoredWallet[] {
  let changed = false;
  const clean = wallets.map(w => {
    if (w && typeof w === 'object' && 'private_key_pem' in w) {
      changed = true;
      const { private_key_pem, ...rest } = w as Record<string, unknown>;
      return rest as unknown as StoredWallet;
    }
    return w as StoredWallet;
  });
  if (changed) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    } catch {
      /* storage cheio/indisponível: a lista em memória já está limpa */
    }
  }
  return clean;
}

export function getStoredWallets(): StoredWallet[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return stripLegacyPrivateKeys(parsed);
  } catch {
    return [];
  }
}

export function saveWallet(wallet: StoredWallet): void {
  const wallets = getStoredWallets();
  const index = wallets.findIndex(w => w.address === wallet.address);

  if (index >= 0) {
    wallets[index] = { ...wallets[index], ...wallet };
  } else {
    wallets.push(wallet);
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(wallets));
}

export function removeWallet(address: string): void {
  const wallets = getStoredWallets().filter(w => w.address !== address);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(wallets));
}

export function clearWallets(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function getWalletCount(): number {
  return getStoredWallets().length;
}
