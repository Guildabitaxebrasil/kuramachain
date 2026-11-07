"""Carteira do nó persistida: o endereço minerador não pode mudar no restart."""
import json
import os

import pytest

import config
from core.mnemonic import generate_mnemonic
from core.wallet import Wallet


def test_load_or_create_persiste_e_reusa_o_mesmo_endereco(tmp_path):
    path = str(tmp_path / 'wallet.json')

    first = Wallet.load_or_create(path)
    assert os.path.exists(path)

    second = Wallet.load_or_create(path)
    assert second.address == first.address
    assert second.private_key_pem == first.private_key_pem
    assert json.load(open(path, encoding='utf-8'))['address'] == first.address


def test_wallet_salva_por_arquivo_ignora_arquivo_corrompido(tmp_path, capsys):
    path = str(tmp_path / 'wallet.json')
    with open(path, 'w', encoding='utf-8') as f:
        f.write('{ isto não é json')

    wallet = Wallet.load_or_create(path)

    assert wallet.address
    assert 'Não foi possível ler a carteira' in capsys.readouterr().out
    # O arquivo foi reescrito com uma carteira válida.
    data = json.load(open(path, encoding='utf-8'))
    assert data['address'] == wallet.address


def test_mnemonic_do_no_tem_prioridade_sobre_o_arquivo(tmp_path, monkeypatch):
    path = str(tmp_path / 'wallet.json')
    salva = Wallet.load_or_create(path)
    monkeypatch.setattr(config, 'NODE_MNEMONIC', generate_mnemonic())

    derivada = Wallet.load_or_create(path)

    assert derivada.address != salva.address
    # A frase manda: chamadas seguintes devolvem a mesma identidade.
    assert Wallet.load_or_create(str(tmp_path / 'outro.json')).address == derivada.address


def test_save_to_file_e_atomico_e_nao_deixa_tmp(tmp_path):
    path = str(tmp_path / 'wallet.json')
    Wallet.load_or_create(path)

    assert os.listdir(tmp_path) == ['wallet.json']


def test_from_dict_reconstroi_a_mesma_carteira():
    original = Wallet()
    copia = Wallet.from_dict(original.to_dict())

    assert copia.address == original.address
    assert copia.public_key_pem == original.public_key_pem
