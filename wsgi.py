"""
WSGI entry point para Render / Gunicorn.
Exporta o objeto 'app' no nível do módulo para o gunicorn importar.

Uso: gunicorn wsgi:app --bind 0.0.0.0:$PORT
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# ─── Força UTF-8 no Windows ──────────────────────────────────────
try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except AttributeError:
    pass

from api.routes import create_app
from core.blockchain import Blockchain
from core.wallet import Wallet
from core.chain_backup import ChainBackup, backup_chain, restore_chain
from config import DEFAULT_DIFFICULTY, CHAIN_FILE, WALLET_FILE

# ─── Espelho remoto ───────────────────────────────────────────────
# No plano free do Render o disco é efêmero: antes de carregar, puxa a
# cadeia do banco remoto (se ela estiver à frente do arquivo local).
chain_backup = ChainBackup.from_env()
if chain_backup:
    restore_chain(chain_backup, CHAIN_FILE)

# ─── Carrega a cadeia do disco ────────────────────────────────────
# Sem isso o processo nascia sempre do gênese: cada restart (deploy,
# spin-down, reload do worker do gunicorn) apagava blocos e saldos.
try:
    blockchain = Blockchain.load_from_file(CHAIN_FILE, difficulty=DEFAULT_DIFFICULTY)
    print(f"[LOAD] Cadeia carregada de {CHAIN_FILE} "
          f"({len(blockchain.chain)} blocos)")
except FileNotFoundError:
    blockchain = Blockchain(difficulty=DEFAULT_DIFFICULTY)
    print(f"[GENESIS] Nenhuma cadeia em {CHAIN_FILE}; começando do gênese")
except Exception as e:
    blockchain = Blockchain(difficulty=DEFAULT_DIFFICULTY)
    print(f"[WARN] Falha ao carregar {CHAIN_FILE} ({e}); começando do gênese")

# Carteira do nó persistida: o endereço minerador tem que sobreviver ao
# restart. Antes era `Wallet()` puro, então cada boot minerava para um
# endereço novo e as recompensas ficavam órfãs.
wallet = Wallet.load_or_create(WALLET_FILE)
miner_address = wallet.address
print(f"[WALLET] Endereço minerador do nó: {miner_address}")


def _persist_chain(*_args, **_kwargs):
    """Autosave: grava a cadeia a cada bloco aceito (minerado ou P2P)."""
    try:
        blockchain.save_to_file(CHAIN_FILE)
    except Exception as e:
        print(f"[WARN] Autosave falhou: {e}")
        return
    # Disco do Render free é efêmero: mantém a cópia no banco remoto.
    backup_chain(chain_backup, CHAIN_FILE)


blockchain.on('on_block_mined', _persist_chain)

# ─── Cria a aplicação Flask ───────────────────────────────────────
app = create_app(
    blockchain=blockchain,
    node_address=miner_address,
    port=int(os.environ.get('PORT', 5000))
)

# ─── Registra Blueprint da Lightning Network ─────────────────────
try:
    from lightning.api import create_lightning_blueprint
    from lightning.lightning_network import LightningNetwork
    ln = LightningNetwork(
        blockchain=blockchain,
        node_address=miner_address,
        private_key_pem=wallet.private_key_pem,
    )
    ln_bp = create_lightning_blueprint(lightning_network=ln)
    app.register_blueprint(ln_bp)
    app.lightning_network = ln
    print("[LIGHTNING] Blueprint da LN registrado em /api/lightning/*")
except Exception as e:
    print(f"[WARN] Lightning: {e}")

# ─── Registra EVM (Contratos Inteligentes / DeFi) ────────────────
try:
    from evm.engine import EVMEngine
    from evm.rpc import create_evm_blueprint
    from config import EVM_AUTO_MINE, EVM_CHAIN_ID
    evm_engine = EVMEngine(auto_mine=EVM_AUTO_MINE)
    app.register_blueprint(create_evm_blueprint(evm_engine))
    app.evm_engine = evm_engine
    blockchain.on('on_block_mined', evm_engine.on_pow_block)
    from evm.deposits import reconcile_native_deposits
    deposit_report = reconcile_native_deposits(blockchain, evm_engine)
    print(f"[EVM] JSON-RPC eth_* registrado em /rpc (chain_id={EVM_CHAIN_ID})")
    if deposit_report['credited'] or deposit_report['failed']:
        print(f"[EVM] depósitos recreditados: {deposit_report['credited']} "
              f"(falhas: {len(deposit_report['failed'])})")
except Exception as e:
    print(f"[WARN] EVM: {e}")

# ─── Error handler ───────────────────────────────────────────────
@app.errorhandler(500)
def internal_error(error):
    import traceback
    traceback.print_exc()
    return {'error': 'Erro interno do servidor'}, 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f"\n[START] Servidor rodando na porta {port}")
    app.run(host='0.0.0.0', port=port, debug=False)
