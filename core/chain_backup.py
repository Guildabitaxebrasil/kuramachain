"""
Espelho remoto da cadeia em Postgres.

O plano free do Render troca o container a cada deploy, restart e spin-down,
e o disco dele é efêmero: `data/blockchain.json` sempre volta ao gênese. Este
módulo guarda o JSON da cadeia numa tabela de um Postgres externo (o Neon
free, por exemplo) e o devolve no boot quando o remoto está à frente do
arquivo local.

Desligado por padrão: só ativa com KURAMA_BACKUP_DATABASE_URL definida.
Nenhuma falha aqui pode derrubar o nó — erro de rede, credencial ou driver
ausente vira warning no log e a cadeia segue local.
"""
import json
import os
import threading
import uuid
from datetime import datetime, timezone

try:
    import psycopg2
except ImportError:  # opcional: sem o driver o nó roda só com o arquivo local
    psycopg2 = None

from config import BACKUP_DATABASE_URL, BACKUP_TIMEOUT

# Uma única linha (id = 1) guarda o estado inteiro da cadeia em JSON.
TABLE_DDL = """
CREATE TABLE IF NOT EXISTS kurama_chain (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    payload    TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
)
"""

UPSERT_SQL = """
INSERT INTO kurama_chain (id, payload, updated_at)
VALUES (1, %s, %s)
ON CONFLICT (id) DO UPDATE
   SET payload = EXCLUDED.payload,
       updated_at = EXCLUDED.updated_at
"""

SELECT_SQL = 'SELECT payload FROM kurama_chain WHERE id = 1'


class ChainBackup:
    """Cliente mínimo (GET/PUT de um JSON) para o espelho remoto."""

    def __init__(self, dsn: str, timeout: int = 10):
        self.dsn = dsn
        self.timeout = int(timeout)

    @classmethod
    def from_env(cls) -> 'ChainBackup':
        """Instância a partir do ambiente; None quando o backup está desligado."""
        if not BACKUP_DATABASE_URL:
            return None
        if psycopg2 is None:
            print('[WARN] Backup remoto ligado, mas psycopg2 não está instalado; '
                  'seguindo só com o arquivo local')
            return None
        return cls(BACKUP_DATABASE_URL, timeout=BACKUP_TIMEOUT)

    def _connect(self):
        # connect_timeout evita travar o boot do nó quando o banco está fora.
        return psycopg2.connect(self.dsn, connect_timeout=self.timeout)

    def upload(self, payload: str) -> bool:
        """Grava o payload remoto. False em qualquer falha (nunca levanta)."""
        if not payload:
            return False
        if psycopg2 is None:
            return False
        conn = None
        try:
            conn = self._connect()
            conn.autocommit = True
            with conn.cursor() as cur:
                cur.execute(TABLE_DDL)
                cur.execute(UPSERT_SQL, (payload, datetime.now(timezone.utc)))
            print(f'[BACKUP] Cadeia enviada ao banco remoto ({len(payload)} bytes)')
            return True
        except Exception as e:
            print(f'[WARN] Backup remoto: falha ao enviar ({e})')
            return False
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass

    def download(self) -> str:
        """Payload remoto, ou None se estiver vazio/inalcançável."""
        if psycopg2 is None:
            return None
        conn = None
        try:
            conn = self._connect()
            conn.autocommit = True
            with conn.cursor() as cur:
                # Cria a tabela se ainda não existe, para o primeiro boot não
                # falhar com "relation does not exist".
                cur.execute(TABLE_DDL)
                cur.execute(SELECT_SQL)
                row = cur.fetchone()
            if not row:
                print('[BACKUP] Banco remoto vazio; seguindo com a cadeia local')
                return None
            return row[0]
        except Exception as e:
            print(f'[WARN] Backup remoto: falha ao baixar ({e})')
            return None
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass


def _chain_length(payload: str) -> int:
    """Nº de blocos de um payload JSON; -1 se o conteúdo não serve."""
    try:
        data = json.loads(payload)
        return len(data.get('chain') or [])
    except (ValueError, TypeError, AttributeError):
        return -1


def restore_chain(backup: ChainBackup, chain_file: str) -> bool:
    """
    Baixa a cadeia remota e grava em `chain_file` se ela estiver à frente.

    Nunca sobrescreve um arquivo local com mais blocos: o remoto só entra
    quando é mais longo (primeiro boot, deploy novo, spin-down).

    Returns:
        True se o arquivo local foi substituído pela cadeia remota.
    """
    if backup is None:
        return False

    remote = backup.download()
    if not remote:
        return False

    remote_len = _chain_length(remote)
    if remote_len <= 0:
        print('[WARN] Backup remoto: payload inválido; mantendo a cadeia local')
        return False

    local_len = -1
    if os.path.exists(chain_file):
        try:
            with open(chain_file, 'r', encoding='utf-8') as f:
                local_len = _chain_length(f.read())
        except OSError as e:
            print(f'[WARN] Não foi possível ler {chain_file}: {e}')

    if remote_len <= local_len:
        print(f'[BACKUP] Remoto com {remote_len} blocos não supera o local '
              f'({local_len}); nada a restaurar')
        return False

    # Escrita atômica: um crash no meio não deixa arquivo pela metade.
    directory = os.path.dirname(os.path.abspath(chain_file))
    os.makedirs(directory, exist_ok=True)
    tmp_path = os.path.join(directory, f'.{uuid.uuid4().hex}.tmp')
    try:
        with open(tmp_path, 'w', encoding='utf-8') as f:
            f.write(remote)
        os.replace(tmp_path, chain_file)
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass

    print(f'[BACKUP] Cadeia restaurada do banco remoto '
          f'({remote_len} blocos, local tinha {local_len})')
    return True


def backup_chain(backup: ChainBackup, chain_file: str) -> bool:
    """Envia o conteúdo atual de `chain_file` para o banco remoto."""
    if backup is None:
        return False
    try:
        with open(chain_file, 'r', encoding='utf-8') as f:
            payload = f.read()
    except OSError as e:
        print(f'[WARN] Backup remoto: não consegui ler {chain_file} ({e})')
        return False
    return backup.upload(payload)
