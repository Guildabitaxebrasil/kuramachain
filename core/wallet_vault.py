"""Cofre local das carteiras criadas ou restauradas pela interface.

O navegador não guarda chave privada: `/wallet/new` e `/wallet/restore`
gravam a chave aqui, no nó, e o envio pela UI manda apenas o endereço de
origem (`from_address`) — quem assina é o servidor.

Senha por carteira: quando a carteira tem senha, a chave NÃO fica em texto
no arquivo. Ela é cifrada com AES-256-GCM e uma chave derivada da senha
(PBKDF2-HMAC-SHA256), e a cifra é vinculada ao endereço (AAD) — sem a senha
o cofre não assina nada. Carteiras criadas antes da senha continuam em
texto até receberem uma (`set_password`).

O arquivo (`WALLETS_FILE`, por padrão `data/wallets.json`) fica com permissão
0600 onde o sistema suporta, é escrito de forma atômica e nunca deve ser
versionado nem servido por HTTP. Num host com disco efêmero (Render free) ele
desaparece no deploy: nesse caso a carteira precisa ser restaurada uma vez
com as 24 palavras.
"""
import base64
import json
import os
import secrets
import threading
import uuid
from datetime import datetime, timezone

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from config import WALLETS_FILE

# 200k iterações (~100 ms num servidor comum): lento o bastante para
# PBKDF2 não virar atalho, rápido o bastante para cada envio.
KDF_ITERATIONS = 200_000
KDF_NAME = 'pbkdf2-sha256'
CIPHER_NAME = 'aes-256-gcm'
MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 256

_lock = threading.Lock()


class VaultError(Exception):
    """Falha esperada do cofre (vira 4xx na API, não 500)."""

    code = 'VAULT_ERROR'

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class WalletNotFound(VaultError):
    """O nó não tem a chave desta carteira (nunca foi criada/restaurada aqui)."""

    code = 'SIGNER_NOT_FOUND'


class PasswordRequired(VaultError):
    """A carteira está protegida e nenhuma senha foi informada."""

    code = 'PASSWORD_REQUIRED'


class WrongPassword(VaultError):
    """A senha informada não abre a chave desta carteira."""

    code = 'WRONG_PASSWORD'


def _load() -> dict:
    """Lê o cofre; arquivo ausente, vazio ou corrompido vira cofre vazio."""
    try:
        with open(WALLETS_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}
    return data if isinstance(data, dict) else {}


def _write(data: dict) -> None:
    """Escrita atômica: um crash no meio não corrompe o cofre inteiro."""
    directory = os.path.dirname(os.path.abspath(WALLETS_FILE))
    os.makedirs(directory, exist_ok=True)
    tmp_path = os.path.join(directory, f'.{uuid.uuid4().hex}.tmp')
    try:
        with open(tmp_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
        try:
            os.chmod(tmp_path, 0o600)
        except OSError:
            pass  # Windows não aplica o modo POSIX
        os.replace(tmp_path, WALLETS_FILE)
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


# ─── Cifra da chave privada ────────────────────────────────────

def _check_password(password: str) -> str:
    if not isinstance(password, str):
        raise ValueError('Senha inválida.')
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(
            f'A senha deve ter pelo menos {MIN_PASSWORD_LENGTH} caracteres.'
        )
    if len(password) > MAX_PASSWORD_LENGTH:
        raise ValueError('A senha é longa demais.')
    return password


def _derive_key(password: str, salt: bytes, iterations: int) -> bytes:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=iterations,
    )
    return kdf.derive(password.encode('utf-8'))


def _encrypt(address: str, private_key_pem: str, password: str) -> dict:
    """Devolve o bloco `cipher` do registro (nunca a chave em texto)."""
    password = _check_password(password)
    salt = secrets.token_bytes(16)
    nonce = secrets.token_bytes(12)
    key = _derive_key(password, salt, KDF_ITERATIONS)
    # O endereço entra como AAD: a cifra não pode ser copiada para outro
    # registro do cofre e decifrada como se fosse daquela carteira.
    data = AESGCM(key).encrypt(nonce, private_key_pem.encode('utf-8'),
                               address.encode('utf-8'))
    return {
        'algo': CIPHER_NAME,
        'kdf': KDF_NAME,
        'iterations': KDF_ITERATIONS,
        'salt': base64.b64encode(salt).decode('ascii'),
        'nonce': base64.b64encode(nonce).decode('ascii'),
        'data': base64.b64encode(data).decode('ascii'),
    }


def _decrypt(address: str, cipher: dict, password: str) -> str:
    """Abre o bloco `cipher`; senha errada vira WrongPassword."""
    if not password:
        raise PasswordRequired(
            'Esta carteira é protegida por senha. Informe a senha para enviar.'
        )
    try:
        salt = base64.b64decode(cipher.get('salt') or '')
        nonce = base64.b64decode(cipher.get('nonce') or '')
        data = base64.b64decode(cipher.get('data') or '')
        iterations = int(cipher.get('iterations') or 0)
    except (ValueError, TypeError):
        raise WalletNotFound(
            'Registro da carteira no nó está corrompido. Restaure-a com as '
            '24 palavras.'
        )
    if not salt or not nonce or not data or iterations <= 0:
        raise WalletNotFound(
            'Registro da carteira no nó está incompleto. Restaure-a com as '
            '24 palavras.'
        )
    key = _derive_key(password, salt, iterations)
    try:
        pem = AESGCM(key).decrypt(nonce, data, address.encode('utf-8'))
    except Exception:
        raise WrongPassword('Senha incorreta para esta carteira.')
    return pem.decode('utf-8')


# ─── Operações do cofre ────────────────────────────────────────

def save_wallet(address: str, private_key_pem: str, public_key: str = '',
                password: str | None = None) -> None:
    """Guarda (ou atualiza) a chave privada de uma carteira no cofre.

    Com `password`, a chave é cifrada. Sem senha, uma carteira que já estava
    protegida CONTINUA protegida (a cifra antiga é mantida): restaurar com as
    24 palavras não rebaixa a proteção. Para trocar a senha, informe uma nova.
    """
    with _lock:
        data = _load()
        existing = data.get(address) or {}
        record = {
            'public_key': public_key or existing.get('public_key', ''),
            'created_at': existing.get('created_at')
            or datetime.now(timezone.utc).isoformat(),
        }
        if password:
            record['cipher'] = _encrypt(address, private_key_pem, password)
        elif existing.get('cipher'):
            record['cipher'] = existing['cipher']
        else:
            record['private_key_pem'] = private_key_pem
        data[address] = record
        _write(data)


def get_private_key(address: str, password: str | None = None) -> str:
    """Devolve a chave privada da carteira, decifrando se preciso.

    Levanta WalletNotFound, PasswordRequired ou WrongPassword.
    """
    entry = _load().get(address) or {}
    cipher = entry.get('cipher')
    if cipher:
        return _decrypt(address, cipher, password or '')
    pem = entry.get('private_key_pem')
    if not pem:
        raise WalletNotFound(
            'Esta carteira não está guardada neste nó. Restaure-a uma única '
            'vez com as 24 palavras para poder enviar.'
        )
    return pem


def wallet_info(address: str) -> dict:
    """Dados públicos do registro da carteira no cofre (sem a chave)."""
    entry = _load().get(address) or {}
    in_vault = bool(entry.get('cipher') or entry.get('private_key_pem'))
    return {
        'address': address,
        'in_vault': in_vault,
        'has_password': bool(entry.get('cipher')),
        'public_key': entry.get('public_key', ''),
    }


def has_wallet(address: str) -> bool:
    """Se o nó tem a chave desta carteira."""
    return wallet_info(address)['in_vault']


def set_password(address: str, password: str, current_password: str = '') -> None:
    """Define (ou troca) a senha de uma carteira que está no cofre.

    Carteira já protegida exige a senha atual. A chave é decifrada e regravada
    cifrada com a senha nova; o texto em claro nunca é persistido.
    """
    with _lock:
        data = _load()
        entry = data.get(address)
        if not entry:
            raise WalletNotFound(
                'Esta carteira não está guardada neste nó. Restaure-a uma '
                'única vez com as 24 palavras.'
            )
        cipher = entry.get('cipher')
        if cipher:
            private_key_pem = _decrypt(address, cipher, current_password or '')
        else:
            private_key_pem = entry.get('private_key_pem') or ''
            if not private_key_pem:
                raise WalletNotFound(
                    'Registro da carteira no nó está incompleto. Restaure-a '
                    'com as 24 palavras.'
                )
        entry.pop('private_key_pem', None)
        entry['cipher'] = _encrypt(address, private_key_pem, password)
        entry.setdefault('created_at', datetime.now(timezone.utc).isoformat())
        data[address] = entry
        _write(data)
