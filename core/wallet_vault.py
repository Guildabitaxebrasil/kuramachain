"""Cofre local das carteiras criadas ou restauradas pela interface.

O navegador não guarda chave privada: `/wallet/new` e `/wallet/restore`
gravam a chave aqui, no nó, e o envio pela UI manda apenas o endereço de
origem (`from_address`) — quem assina é o servidor.

O arquivo (`WALLETS_FILE`, por padrão `data/wallets.json`) fica com permissão
0600 onde o sistema suporta, é escrito de forma atômica e nunca deve ser
versionado nem servido por HTTP. Num host com disco efêmero (Render free) ele
desaparece no deploy: nesse caso a carteira precisa ser restaurada uma vez
com as 24 palavras.
"""
import json
import os
import threading
import uuid

from config import WALLETS_FILE

_lock = threading.Lock()


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


def save_wallet(address: str, private_key_pem: str, public_key: str = '') -> None:
    """Guarda (ou atualiza) a chave privada de uma carteira no cofre."""
    with _lock:
        data = _load()
        existing = data.get(address) or {}
        data[address] = {
            'private_key_pem': private_key_pem,
            'public_key': public_key or existing.get('public_key', ''),
        }
        _write(data)


def get_private_key(address: str) -> str | None:
    """Devolve a chave privada guardada para `address` (ou None)."""
    entry = _load().get(address) or {}
    return entry.get('private_key_pem') or None


def has_wallet(address: str) -> bool:
    """Se o nó tem a chave desta carteira e consegue assinar por ela."""
    return get_private_key(address) is not None
