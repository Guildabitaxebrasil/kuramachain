"""
Testes do espelho remoto da cadeia (sem banco real).

O `ChainBackup` é substituído por um dublê para exercitar a lógica de
restauração (quem ganha quando local e remoto divergem) e o envio do
arquivo. A única chamada que toca a rede é a de falha de conexão, que
aponta para uma porta fechada em localhost.
"""
import json
import os
import shutil
import tempfile
import unittest
from unittest import mock

import core.chain_backup as chain_backup_module
from core.chain_backup import ChainBackup, backup_chain, restore_chain


def _payload(blocks: int) -> str:
    return json.dumps({
        'chain': [{'index': i} for i in range(blocks)],
        'pending_transactions': [],
        'difficulty': 4,
    })


class FakeBackup:
    def __init__(self, payload=None):
        self.payload = payload
        self.uploaded = None

    def download(self):
        return self.payload

    def upload(self, payload):
        self.uploaded = payload
        return True


class RestoreChainTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.chain_file = os.path.join(self.dir, 'blockchain.json')

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def _write_local(self, blocks):
        with open(self.chain_file, 'w', encoding='utf-8') as f:
            f.write(_payload(blocks))

    def _local_blocks(self):
        with open(self.chain_file, 'r', encoding='utf-8') as f:
            return len(json.load(f)['chain'])

    def test_sem_backup_nao_faz_nada(self):
        self.assertFalse(restore_chain(None, self.chain_file))
        self.assertFalse(os.path.exists(self.chain_file))

    def test_restaura_quando_remoto_esta_a_frente(self):
        self._write_local(1)
        self.assertTrue(restore_chain(FakeBackup(_payload(5)), self.chain_file))
        self.assertEqual(self._local_blocks(), 5)

    def test_restaura_quando_arquivo_local_nao_existe(self):
        self.assertTrue(restore_chain(FakeBackup(_payload(3)), self.chain_file))
        self.assertEqual(self._local_blocks(), 3)

    def test_nao_sobrescreve_local_com_mais_blocos(self):
        self._write_local(9)
        self.assertFalse(restore_chain(FakeBackup(_payload(4)), self.chain_file))
        self.assertEqual(self._local_blocks(), 9)

    def test_empate_mantem_local(self):
        self._write_local(4)
        self.assertFalse(restore_chain(FakeBackup(_payload(4)), self.chain_file))
        self.assertEqual(self._local_blocks(), 4)

    def test_payload_invalido_e_ignorado(self):
        self.assertFalse(restore_chain(FakeBackup('não é json'), self.chain_file))
        self.assertFalse(os.path.exists(self.chain_file))

    def test_remoto_vazio_e_ignorado(self):
        self.assertFalse(restore_chain(FakeBackup(None), self.chain_file))
        self.assertFalse(os.path.exists(self.chain_file))

    def test_restauracao_nao_deixa_arquivo_temporario(self):
        self.assertTrue(restore_chain(FakeBackup(_payload(2)), self.chain_file))
        leftovers = [n for n in os.listdir(self.dir) if n.endswith('.tmp')]
        self.assertEqual(leftovers, [])


class BackupChainTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.chain_file = os.path.join(self.dir, 'blockchain.json')

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def test_envia_conteudo_do_arquivo(self):
        with open(self.chain_file, 'w', encoding='utf-8') as f:
            f.write(_payload(4))
        backup = FakeBackup()
        self.assertTrue(backup_chain(backup, self.chain_file))
        self.assertEqual(len(json.loads(backup.uploaded)['chain']), 4)

    def test_arquivo_ausente_nao_quebra(self):
        self.assertFalse(backup_chain(FakeBackup(), self.chain_file))

    def test_sem_backup_configurado_nao_faz_nada(self):
        self.assertFalse(backup_chain(None, self.chain_file))


class ChainBackupClientTests(unittest.TestCase):
    def test_from_env_desligado_sem_url(self):
        with mock.patch.object(chain_backup_module, 'BACKUP_DATABASE_URL', ''):
            self.assertIsNone(ChainBackup.from_env())

    def test_from_env_liga_quando_ha_url_e_driver(self):
        with mock.patch.object(chain_backup_module, 'BACKUP_DATABASE_URL',
                               'postgresql://usuario:senha@host:5432/db'):
            backup = ChainBackup.from_env()
        if chain_backup_module.psycopg2 is None:
            # Sem o driver instalado o nó segue só com o arquivo local.
            self.assertIsNone(backup)
        else:
            self.assertIsInstance(backup, ChainBackup)
            self.assertEqual(backup.timeout, int(chain_backup_module.BACKUP_TIMEOUT))

    def test_falha_de_conexao_nao_levanta(self):
        # Porta 1 em localhost: recusa imediata, sem depender de rede externa.
        backup = ChainBackup('postgresql://u:p@127.0.0.1:1/kurama', timeout=2)
        self.assertFalse(backup.upload('{"chain": []}'))
        self.assertIsNone(backup.download())


if __name__ == '__main__':
    unittest.main()
