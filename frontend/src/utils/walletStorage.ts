/**
 * Utilitário para armazenar carteiras no localStorage.
 * As carteiras ficam disponíveis entre sessões (persistência local).
 *
 * ATENÇÃO: A chave privada é armazenada no navegador!
 * Isso é aceitável para ambiente de desenvolvimento/educacional.
 * Em produção, a chave privada NUNCA deve ser armazenada no navegador
 * sem criptografia adequada (ex: usar Web Crypto API + senha).
 */

export interface StoredWallet {
  address: string;
  public_key: string;
  private_key_pem: string;
  label: string;
  created_at: number;
}

const STORAGE_KEY = 'kurama_wallets';

export function getStoredWallets(): StoredWallet[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as StoredWallet[];
  } catch {
    return [];
  }
}

export function saveWallet(wallet: StoredWallet): void {
  const wallets = getStoredWallets();
  const index = wallets.findIndex(w => w.address === wallet.address);

  if (index >= 0) {
    // Carteira já salva: aproveita para gravar a chave privada agora que ela
    // chegou. Sem isso, quem restaurou uma carteira salva antes (sem chave)
    // continuava sem conseguir enviar, porque o registro antigo era mantido.
    if (wallet.private_key_pem) {
      wallets[index] = {
        ...wallets[index],
        public_key: wallet.public_key || wallets[index].public_key,
        private_key_pem: wallet.private_key_pem,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(wallets));
    }
    return;
  }

  wallets.push(wallet);
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
