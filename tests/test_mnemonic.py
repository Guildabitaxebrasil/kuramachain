"""Testes da frase de recuperação de carteira (BIP39, 24 palavras)."""
import unittest

from api.routes import create_app
from core.mnemonic import (
    generate_mnemonic,
    is_valid_mnemonic,
    mnemonic_to_seed,
    private_key_pem_from_mnemonic,
    seed_to_private_key,
)
from core.wallet import Wallet


class TestMnemonic(unittest.TestCase):
    """Geração, validação e derivação de chave a partir da frase."""

    def test_gera_24_palavras_validas(self):
        phrase = generate_mnemonic()
        self.assertEqual(len(phrase.split()), 24)
        self.assertTrue(is_valid_mnemonic(phrase))

    def test_frases_sao_sempre_diferentes(self):
        self.assertNotEqual(generate_mnemonic(), generate_mnemonic())

    def test_rejeita_frase_com_checksum_invalido(self):
        # 24 palavras da wordlist, mas sem checksum válido
        self.assertFalse(is_valid_mnemonic(' '.join(['abacate'] * 24)))

    def test_rejeita_quantidade_de_palavras_invalida(self):
        self.assertFalse(is_valid_mnemonic('abacate abaixo abalar'))
        self.assertFalse(is_valid_mnemonic(''))

    def test_seed_segue_vetor_oficial_bip39(self):
        # Vetor oficial (passphrase TREZOR) — verifica o PBKDF2-HMAC-SHA512
        phrase = ' '.join(['abandon'] * 11 + ['about'])
        seed = mnemonic_to_seed(phrase, 'TREZOR')
        self.assertEqual(
            seed.hex(),
            'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e5349553'
            '1f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04',
        )

    def test_chave_privada_segue_vetor_oficial_bip32(self):
        seed = bytes.fromhex('000102030405060708090a0b0c0d0e0f')
        self.assertEqual(
            seed_to_private_key(seed).hex(),
            'e8f32e723decf4051aefac8e2c93c9c5b214313817cdb01a1494b917c8436b35',
        )

    def test_mesma_frase_gera_mesma_chave(self):
        phrase = generate_mnemonic()
        self.assertEqual(
            private_key_pem_from_mnemonic(phrase),
            private_key_pem_from_mnemonic(phrase),
        )
        self.assertNotEqual(
            private_key_pem_from_mnemonic(phrase),
            private_key_pem_from_mnemonic(generate_mnemonic()),
        )


class TestWalletMnemonicAPI(unittest.TestCase):
    """A frase devolvida por /wallet/new precisa recriar a carteira criada."""

    @classmethod
    def setUpClass(cls):
        cls.app = create_app(port=5000)
        cls.client = cls.app.test_client()

    def test_restaura_carteira_com_a_frase(self):
        frase = generate_mnemonic()
        esperada = Wallet(private_key_pem=private_key_pem_from_mnemonic(frase))

        resp = self.client.post('/wallet/restore', json={'mnemonic': frase})
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()

        self.assertEqual(data['address'], esperada.address)
        self.assertEqual(data['private_key_pem'], esperada.private_key_pem)
        self.assertTrue(data['restored'])
        self.assertEqual(data['mnemonic_words'], 24)

    def test_restauracao_aceita_frase_com_espacos_extras(self):
        frase = generate_mnemonic()
        esperada = Wallet(private_key_pem=private_key_pem_from_mnemonic(frase))

        resp = self.client.post(
            '/wallet/restore',
            json={'mnemonic': '  ' + frase.upper() + '\n'},
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()['address'], esperada.address)

    def test_restauracao_rejeita_frase_invalida(self):
        resp = self.client.post(
            '/wallet/restore',
            json={'mnemonic': ' '.join(['abacate'] * 24)},
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn('error', resp.get_json())

    def test_restauracao_rejeita_frase_vazia(self):
        resp = self.client.post('/wallet/restore', json={})
        self.assertEqual(resp.status_code, 400)

    def test_frase_devolvida_recria_a_carteira(self):
        resp = self.client.post('/wallet/new', json={})
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()

        phrase = data['mnemonic']
        self.assertEqual(len(phrase.split()), 24)
        self.assertTrue(is_valid_mnemonic(phrase))

        restaurada = Wallet(private_key_pem=private_key_pem_from_mnemonic(phrase))
        self.assertEqual(restaurada.address, data['address'])
        self.assertEqual(restaurada.private_key_pem, data['private_key_pem'])


if __name__ == '__main__':
    unittest.main()
