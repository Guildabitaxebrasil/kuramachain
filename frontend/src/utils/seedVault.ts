/**
 * Cofre local OPCIONAL para a frase de recuperação.
 *
 * A frase nunca é guardada em texto puro: aqui ela vai cifrada com
 * AES-256-GCM, usando uma chave derivada da senha do usuário via
 * PBKDF2-HMAC-SHA256 (250 mil iterações) e salt aleatório.
 *
 * Só existe conteúdo neste cofre se o usuário escolher guardar a frase
 * ao criá-la. Sem a senha, o que está no localStorage não revela as palavras.
 */

const VAULT_KEY = 'kurama_seed_vault';
const PBKDF2_ITERATIONS = 250_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

interface VaultEntry {
  /** Salt do PBKDF2 (base64). */
  salt: string;
  /** IV do AES-GCM (base64). */
  iv: string;
  /** Frase cifrada + tag de autenticação (base64). */
  data: string;
  created_at: number;
}

type Vault = Record<string, VaultEntry>;

function subtle(): SubtleCrypto {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Web Crypto indisponível: use HTTPS ou localhost para exportar a frase.');
  }
  return crypto.subtle;
}

function randomBuffer(length: number): ArrayBuffer {
  return crypto.getRandomValues(new Uint8Array(length)).buffer;
}

function toBase64(buffer: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(buffer)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function readVault(): Vault {
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Vault;
  } catch {
    return {};
  }
}

function writeVault(vault: Vault): void {
  localStorage.setItem(VAULT_KEY, JSON.stringify(vault));
}

async function deriveKey(password: string, salt: ArrayBuffer): Promise<CryptoKey> {
  const baseKey = await subtle().importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle().deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Se existe cópia cifrada da frase para este endereço. */
export function hasSeedBackup(address: string): boolean {
  return Boolean(readVault()[address]);
}

/** Salva a frase cifrada com a senha informada (a senha não é armazenada). */
export async function saveSeedBackup(address: string, mnemonic: string, password: string): Promise<void> {
  const salt = randomBuffer(SALT_BYTES);
  const iv = randomBuffer(IV_BYTES);
  const key = await deriveKey(password, salt);
  const ciphertext = await subtle().encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(mnemonic),
  );

  const vault = readVault();
  vault[address] = {
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(ciphertext),
    created_at: Date.now(),
  };
  writeVault(vault);
}

/**
 * Decifra a frase guardada para o endereço.
 *
 * @throws Error quando não há cópia ou a senha está errada.
 */
export async function loadSeedBackup(address: string, password: string): Promise<string> {
  const entry = readVault()[address];
  if (!entry) {
    throw new Error('Não há frase guardada para esta carteira.');
  }

  try {
    const key = await deriveKey(password, fromBase64(entry.salt));
    const plaintext = await subtle().decrypt(
      { name: 'AES-GCM', iv: fromBase64(entry.iv) },
      key,
      fromBase64(entry.data),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    // AES-GCM falha na autenticação quando a senha está errada.
    throw new Error('Senha incorreta. Verifique e tente novamente.');
  }
}
