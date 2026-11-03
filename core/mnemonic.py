"""
Frases de recuperação de carteira (seed phrases) — padrão BIP39.

A frase padrão da KuramaChain tem 24 palavras (256 bits de entropia +
8 bits de checksum), no mesmo modelo usado por carteiras como a MetaMask.

Segurança — leia antes de usar:
- A frase é gerada apenas em memória. Ela NUNCA deve ser gravada em disco,
  banco de dados, log, localStorage ou qualquer outro armazenamento.
- Quem tiver a frase controla a carteira. Ela deve ser anotada em papel
  pelo próprio usuário, uma única vez.
- A derivação de chave segue BIP39 (PBKDF2-HMAC-SHA512) + BIP32 (chave
  mestra), portanto a mesma frase sempre recria a mesma carteira.
"""
import hashlib
import hmac
import secrets
import unicodedata
from pathlib import Path
from typing import List, Optional, Sequence

WORDLIST_PATH = Path(__file__).resolve().parent / 'wordlists' / 'bip39_portuguese.txt'

# Contagens de palavras previstas no BIP39
SUPPORTED_WORD_COUNTS = (12, 15, 18, 21, 24)
DEFAULT_WORD_COUNT = 24

_PBKDF2_ROUNDS = 2048
_PBKDF2_DKLEN = 64
_BIP32_KEY = b'Bitcoin seed'

_wordlist_cache: Optional[List[str]] = None


def load_wordlist(path: Optional[Path] = None) -> List[str]:
    """Carrega a wordlist BIP39 (2048 palavras, em ordem alfabética)."""
    global _wordlist_cache
    if path is not None:
        return _read_wordlist(Path(path))
    if _wordlist_cache is None:
        _wordlist_cache = _read_wordlist(WORDLIST_PATH)
    return _wordlist_cache


def _read_wordlist(path: Path) -> List[str]:
    words = path.read_text(encoding='utf-8').split()
    if len(words) != 2048:
        raise ValueError(
            f'Wordlist BIP39 inválida em {path}: '
            f'esperadas 2048 palavras, encontradas {len(words)}.'
        )
    return words


def _normalize(text: str) -> str:
    """Normalização NFKD exigida pelo BIP39."""
    return unicodedata.normalize('NFKD', text)


def generate_mnemonic(
    word_count: int = DEFAULT_WORD_COUNT,
    words: Optional[Sequence[str]] = None,
) -> str:
    """
    Gera uma frase de recuperação nova usando entropia do sistema (secrets).

    Args:
        word_count: 12, 15, 18, 21 ou 24 palavras (padrão: 24).
        words: wordlist opcional (usada em testes); por padrão, a portuguesa.

    Returns:
        Frase com as palavras separadas por espaço.
    """
    if word_count not in SUPPORTED_WORD_COUNTS:
        raise ValueError(
            f'word_count deve ser um de {SUPPORTED_WORD_COUNTS}, recebido {word_count}.'
        )
    wordlist = list(words) if words is not None else load_wordlist()
    entropy = secrets.token_bytes(_entropy_bytes(word_count))
    return _encode(entropy, wordlist)


def is_valid_mnemonic(
    mnemonic: str,
    words: Optional[Sequence[str]] = None,
) -> bool:
    """Valida quantidade de palavras, pertencimento à wordlist e checksum."""
    wordlist = list(words) if words is not None else load_wordlist()
    parts = mnemonic.split()
    if len(parts) not in SUPPORTED_WORD_COUNTS:
        return False
    index_of = {word: i for i, word in enumerate(wordlist)}
    try:
        indices = [index_of[word] for word in parts]
    except KeyError:
        return False

    bits = ''.join(f'{index:011b}' for index in indices)
    checksum_bits = len(parts) * 11 // 33
    entropy_bits = len(bits) - checksum_bits
    entropy = int(bits[:entropy_bits], 2).to_bytes(entropy_bits // 8, 'big')
    expected = _checksum(entropy, checksum_bits)
    return bits[entropy_bits:] == expected


def mnemonic_to_seed(mnemonic: str, passphrase: str = '') -> bytes:
    """
    Deriva a seed de 64 bytes da frase (BIP39: PBKDF2-HMAC-SHA512, 2048 rodadas).

    A frase é normalizada em memória; nada é gravado em disco.
    """
    normalized = _normalize(' '.join(mnemonic.split()))
    salt = _normalize('mnemonic' + passphrase)
    return hashlib.pbkdf2_hmac(
        'sha512',
        normalized.encode('utf-8'),
        salt.encode('utf-8'),
        _PBKDF2_ROUNDS,
        dklen=_PBKDF2_DKLEN,
    )


def seed_to_private_key(seed: bytes) -> bytes:
    """
    Deriva a chave privada a partir da seed usando a chave mestra BIP32.

    I = HMAC-SHA512(key="Bitcoin seed", data=seed); a chave privada é a
    metade esquerda (IL), interpretada como escalar da curva secp256k1.
    """
    from ecdsa import SECP256k1

    digest = hmac.new(_BIP32_KEY, seed, hashlib.sha512).digest()
    key_bytes = digest[:32]
    scalar = int.from_bytes(key_bytes, 'big')
    if scalar == 0 or scalar >= SECP256k1.order:
        # Probabilidade ~0; só acontece com entropia degenerada.
        raise ValueError('Seed BIP32 inválida: chave privada fora da curva secp256k1.')
    return key_bytes


def private_key_pem_from_mnemonic(mnemonic: str, passphrase: str = '') -> str:
    """
    Converte uma frase de recuperação na chave privada PEM usada pela Wallet.

    Returns:
        Chave privada EC (secp256k1) em PEM.
    """
    from ecdsa import SECP256k1, SigningKey

    seed = mnemonic_to_seed(mnemonic, passphrase)
    key = SigningKey.from_string(seed_to_private_key(seed), curve=SECP256k1)
    return key.to_pem().decode('utf-8')


# ─── Internos ────────────────────────────────────────────────────────────


def _entropy_bytes(word_count: int) -> int:
    bits = word_count * 11
    return (bits - bits // 33) // 8


def _checksum(entropy: bytes, checksum_bits: int) -> str:
    digest = hashlib.sha256(entropy).digest()
    return ''.join(f'{byte:08b}' for byte in digest)[:checksum_bits]


def _encode(entropy: bytes, words: Sequence[str]) -> str:
    checksum_bits = len(entropy) * 8 // 32
    bits = ''.join(f'{byte:08b}' for byte in entropy) + _checksum(entropy, checksum_bits)
    indices = [int(bits[i:i + 11], 2) for i in range(0, len(bits), 11)]
    return ' '.join(words[index] for index in indices)
