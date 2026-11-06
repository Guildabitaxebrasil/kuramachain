"""
Harness de ataques local (não destrutivo) — KuramaChain.

Executa contra a própria aplicação via Flask test client, sem abrir porta
nem tocar em dados de produção. Cobre:

  1. Autenticação P2P (HMAC/nonce/assinatura): bypass, replay, troca de rota
  2. Forja de bloco P2P: coinbase arbitrária, tx sem fundos, PoW fraco,
     timestamp antigo, tx duplicada
  3. SSRF no registro de peers (IPv4, IPv6, DNS rebinding)
  4. Rate limiting: bucket compartilhado por IP e XFF forjado
  5. Path traversal no catch-all do SPA
  6. JSON-RPC EVM: batch, métodos destrutivos, vazamento de erro
  7. Entradas: payload gigante, JSON profundo, transação adulterada,
     gasto duplo, replay de transação
  8. Exposição de chave privada em modo dev/prod

Uso:
    python scripts/security_probe.py
"""
import base64
import io
import json
import logging
import os
import sys
import time
import contextlib

logging.disable(logging.CRITICAL)

# NETWORK_SECRET precisa existir ANTES de importar config/routes.
os.environ.setdefault('NETWORK_SECRET', 'probe-secret-0123456789abcdef0123456789')
os.environ.setdefault('KURAMA_PRODUCTION', 'false')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from core.blockchain import Blockchain
from core.crypto_utils import CryptoUtils
from core.transaction import Transaction
from core.wallet import Wallet
from core.block import Block
from config import NODE_AUTH_HEADER, P2P_TIMESTAMP_HEADER, P2P_NONCE_HEADER, P2P_SIGNATURE_HEADER, P2P_PUBKEY_HEADER, NETWORK_SECRET
import api.routes as routes
from api.routes import create_app, rate_limiter, p2p_rate_limiter, mining_rate_limiter

SINK = io.StringIO()
RESULTS = []


def record(verdict, name, detail=""):
    RESULTS.append((verdict, name, detail))
    print(f'[{verdict:9}] {name:52} {detail}', flush=True)


def fresh_app(difficulty=2):
    """App novo com limitadores zerados (evita 429 entre baterias)."""
    for lim in (rate_limiter, p2p_rate_limiter, mining_rate_limiter):
        lim._ip_clients.clear()
        lim._wallet_clients.clear()
        lim._rejection_count.clear()
    bc = Blockchain(difficulty=difficulty)
    bc.adjust_difficulty = lambda: None
    app = create_app(blockchain=bc, node_address=Wallet().address, mining_cooldown=0)
    app.config['TESTING'] = False
    return bc, app, app.test_client()


def solve(block, difficulty, dual=True):
    """Resolve o PoW.

    `dual=True` também satisfaz a checagem (incorreta) de /blocks/new, que
    calcula `hash_block(to_dict())` — um digest que inclui o próprio campo
    `hash`. Sem isso o bloco legítimo é rejeitado com "Proof of Work inválido".
    """
    guard = 0
    while True:
        block.hash = block.calculate_hash()
        ok_primary = CryptoUtils.is_hash_valid(block.hash, difficulty)
        ok_gateway = (not dual) or CryptoUtils.is_hash_valid(
            CryptoUtils.hash_block(block.to_dict()), difficulty)
        if ok_primary and ok_gateway:
            return block
        block.proof += 1
        guard += 1
        if guard > 5_000_000:
            raise RuntimeError('PoW não convergiu')


def make_block(bc, transactions, *, index=None, difficulty=None,
               timestamp=None, previous_hash=None):
    block = Block(
        index=len(bc.chain) if index is None else index,
        transactions=transactions,
        proof=0,
        previous_hash=bc.last_block.hash if previous_hash is None else previous_hash,
        difficulty=bc.difficulty if difficulty is None else difficulty,
        timestamp=timestamp if timestamp is not None else time.time(),
    )
    return solve(block, block.difficulty if block.difficulty is not None else bc.difficulty)


def coinbase(receiver, amount=10.0):
    return Transaction(sender='0', receiver=receiver, amount=amount)


def p2p_post(client, path, payload, *, key=None, remote='198.51.100.10',
             override_mac=None, override_path=None, sign=False,
             nonce_pair=None, timestamp=None):
    """POST P2P com HMAC+nonce+assinatura ECDSA corretos por padrão."""
    key = key or P2P_KEY
    now = int(timestamp if timestamp is not None else time.time())
    # O nonce anti-replay é o do header (consumido em _require_p2p_hmac).
    # O corpo pode levar envelope, mas não precisa de um segundo nonce.
    if nonce_pair:
        header_nonce, body_nonce = nonce_pair
    else:
        header_nonce = CryptoUtils.generate_p2p_nonce()
        body_nonce = CryptoUtils.generate_p2p_nonce()
    full = dict(payload)
    full['_nonce'] = body_nonce
    full['_timestamp'] = now
    full['_expires'] = now + 25
    body = json.dumps(full, sort_keys=True).encode('utf-8')
    mac = CryptoUtils.p2p_request_mac(
        NETWORK_SECRET, 'POST', override_path or path, str(now), header_nonce, body)
    headers = {
        NODE_AUTH_HEADER: override_mac if override_mac is not None else mac,
        P2P_TIMESTAMP_HEADER: str(now),
        P2P_NONCE_HEADER: header_nonce,
        'Content-Type': 'application/json',
    }
    if sign:
        headers[P2P_SIGNATURE_HEADER] = CryptoUtils.sign_p2p_message(
            key.private_key_pem, full)
        # PEM cru tem newlines e não cabe em header HTTP.
        headers[P2P_PUBKEY_HEADER] = base64.b64encode(
            key.public_key_pem.encode('utf-8')
        ).decode('ascii')
    return client.post(path, data=body, headers=headers,
                       environ_base={'REMOTE_ADDR': remote})


P2P_KEY = Wallet()


# ═══════════════════════════════════════════════════════════════════
# 1. Autenticação P2P
# ═══════════════════════════════════════════════════════════════════
def battery_auth():
    print('\n== 1. Autenticação P2P ==', flush=True)
    bc, app, c = fresh_app()
    block = make_block(bc, [coinbase(Wallet().address)]).to_dict()

    r = c.post('/blocks/new', json={'block': block},
               environ_base={'REMOTE_ADDR': '198.51.100.11'})
    record('BLOQUEADO' if r.status_code == 401 else 'FALHA',
           'Sem headers P2P', f'{r.status_code}')

    r = p2p_post(c, '/blocks/new', {'block': block}, override_mac='0' * 64)
    record('BLOQUEADO' if r.status_code == 401 else 'FALHA',
           'HMAC inválido', f'{r.status_code}')

    # MAC válido, mas emitido para outra rota
    r = p2p_post(c, '/nodes/register', {'nodes': []}, override_path='/blocks/new')
    record('BLOQUEADO' if r.status_code == 401 else 'FALHA',
           'MAC de outra rota (path confusion)', f'{r.status_code}')

    # Replay: reenvia exatamente o mesmo par de nonces
    pair = (CryptoUtils.generate_p2p_nonce(), CryptoUtils.generate_p2p_nonce())
    r1 = p2p_post(c, '/nodes/register', {'nodes': []}, nonce_pair=pair)
    r2 = p2p_post(c, '/nodes/register', {'nodes': []}, nonce_pair=pair)
    record('BLOQUEADO' if (r1.status_code == 201 and r2.status_code == 401) else 'FALHA',
           'Replay de nonce', f'{r1.status_code} -> {r2.status_code}')

    r = p2p_post(c, '/nodes/register', {'nodes': []},
                 timestamp=int(time.time()) - 600)
    record('BLOQUEADO' if r.status_code == 401 else 'FALHA',
           'Timestamp 10 min no passado', f'{r.status_code}')

    # /blocks/new exige ECDSA; sem os headers deve recusar
    blk = make_block(bc, [coinbase(Wallet().address)]).to_dict()
    r = p2p_post(c, '/blocks/new', {'block': blk})
    record('BLOQUEADO' if r.status_code == 401 else 'FALHA',
           'Bloco sem assinatura ECDSA', f'{r.status_code}')

    # O transporte usa Base64; o PEM cru não cabe em header HTTP.
    try:
        c.post('/nodes/register', json={'nodes': []}, headers={
            P2P_PUBKEY_HEADER: P2P_KEY.public_key_pem})
        record('FALHA', 'PEM cru em header HTTP', 'aceito')
    except ValueError as exc:
        record('OK', 'PEM cru rejeitado pelo HTTP (Base64 é usado)',
               f'{type(exc).__name__}')

    try:
        import requests
        requests.Request('POST', 'http://127.0.0.1:9/', headers={
            P2P_PUBKEY_HEADER: P2P_KEY.public_key_pem}).prepare()
        record('FALHA', 'Cliente requests aceita PEM multilinha', 'preparou')
    except Exception as exc:
        record('OK' if 'InvalidHeader' in type(exc).__name__ else 'FALHA',
               'Cliente oficial recusa PEM cru (usa Base64)',
               f'{type(exc).__name__}')

    r = p2p_post(c, '/nodes/register', {'nodes': []})
    record('ACEITO (esperado)' if r.status_code == 201 else 'FALHA',
           'Requisição P2P legítima (HMAC + nonce no corpo)', f'{r.status_code}')

    # Formato que o cliente oficial usa: nonce só no header, sem os campos
    # _nonce/_timestamp/_expires no corpo (NodeManager.register_neighbors).
    now = int(time.time())
    hn = CryptoUtils.generate_p2p_nonce()
    body = json.dumps({'nodes': []}, sort_keys=True).encode()
    mac = CryptoUtils.p2p_request_mac(NETWORK_SECRET, 'POST', '/nodes/register',
                                      str(now), hn, body)
    r = c.post('/nodes/register', data=body, content_type='application/json',
               headers={NODE_AUTH_HEADER: mac, P2P_TIMESTAMP_HEADER: str(now),
                        P2P_NONCE_HEADER: hn},
               environ_base={'REMOTE_ADDR': '198.51.100.13'})
    record('ACEITO (esperado)' if r.status_code == 201 else 'FALHA',
           'Registro no formato do cliente oficial', f'{r.status_code}')

    # Mesmo problema em /nodes/resolve
    now = int(time.time())
    hn = CryptoUtils.generate_p2p_nonce()
    body = json.dumps({}, sort_keys=True).encode()
    mac = CryptoUtils.p2p_request_mac(NETWORK_SECRET, 'POST', '/nodes/resolve',
                                      str(now), hn, body)
    r = c.post('/nodes/resolve', data=body, content_type='application/json',
               headers={NODE_AUTH_HEADER: mac, P2P_TIMESTAMP_HEADER: str(now),
                        P2P_NONCE_HEADER: hn},
               environ_base={'REMOTE_ADDR': '198.51.100.14'})
    record('ACEITO (esperado)' if r.status_code == 200 else 'FALHA',
           '/nodes/resolve no formato do cliente oficial', f'{r.status_code}')

    # MAC válido com corpo adulterado depois do MAC
    now = int(time.time())
    nonce = CryptoUtils.generate_p2p_nonce()
    body_ok = json.dumps({'_nonce': nonce, '_timestamp': now, '_expires': now + 25,
                          'nodes': []}, sort_keys=True).encode()
    mac = CryptoUtils.p2p_request_mac(NETWORK_SECRET, 'POST', '/nodes/register',
                                      str(now), nonce, body_ok)
    body_bad = body_ok.replace(b'[]', b'["http://evil.example"]')
    r = c.post('/nodes/register', data=body_bad, headers={
        NODE_AUTH_HEADER: mac, P2P_TIMESTAMP_HEADER: str(now),
        P2P_NONCE_HEADER: nonce, 'Content-Type': 'application/json'},
        environ_base={'REMOTE_ADDR': '198.51.100.12'})
    record('BLOQUEADO' if r.status_code == 401 else 'FALHA',
           'Corpo adulterado após o MAC', f'{r.status_code}')

    # Transporte corrigido: assinatura ECDSA + pubkey em Base64.
    bc2, app2, c2 = fresh_app()
    blk2 = make_block(bc2, [coinbase(Wallet().address, 10.0)])
    r = p2p_post(c2, '/blocks/new', {'block': blk2.to_dict()}, sign=True,
                 remote='198.51.100.15')
    record('ACEITO (esperado)' if r.status_code == 201 else 'FALHA',
           'Bloco assinado com pubkey em Base64', f'{r.status_code}')


# ═══════════════════════════════════════════════════════════════════
# 2. Forja de bloco via /blocks/new
# ═══════════════════════════════════════════════════════════════════
def battery_block_forgery():
    print('\n== 2. Forja de bloco P2P ==', flush=True)
    # A assinatura ECDSA é impossível de enviar (PEM multilinha em header).
    # Para auditar os validadores do /blocks/new, relaxamos SÓ a exigência
    # de assinatura; HMAC + nonce continuam obrigatórios. É o cenário que
    # se abre no instante em que o encoding do header for corrigido.
    import config
    previous_require = config.P2P_REQUIRE_SIGNATURE
    config.P2P_REQUIRE_SIGNATURE = False

    # 2a. Coinbase de 1 bilhão
    bc, app, c = fresh_app()
    attacker = Wallet()
    blk = make_block(bc, [coinbase(attacker.address, 1_000_000_000.0)])
    before = bc.get_total_supply()
    r = p2p_post(c, '/blocks/new', {'block': blk.to_dict()})
    supply = bc.get_total_supply()
    if r.status_code == 201 and supply > before:
        record('VULN', 'Coinbase arbitrária (1e9 KUR) aceita',
               f'201 | supply {before:.0f} -> {supply:.0f}')
    else:
        record('BLOQUEADO', 'Coinbase arbitrária (1e9 KUR)', f'{r.status_code}')

    # 2b. Transação sem fundos, fora da mempool
    bc, app, c = fresh_app()
    victim = Wallet()
    src = Wallet()
    tx = Transaction(sender=src.public_key_pem, receiver=victim.address,
                     amount=500.0, fee=0.001, sender_address=src.address)
    tx.sign(src.private_key_pem)
    blk = make_block(bc, [coinbase(src.address), tx])
    r = p2p_post(c, '/blocks/new', {'block': blk.to_dict()})
    bal = bc.get_balance(victim.address)
    if r.status_code == 201 and bal >= 500:
        record('VULN', 'Tx sem fundos/fora da mempool aceita',
               f'201 | saldo da vítima {bal:.3f}')
    else:
        record('BLOQUEADO', 'Tx sem fundos/fora da mempool', f'{r.status_code}')

    # 2c. PoW fraco (difficulty 0.5 vs 2 exigida)
    bc, app, c = fresh_app()
    blk = make_block(bc, [coinbase(Wallet().address)], difficulty=0.5)
    r = p2p_post(c, '/blocks/new', {'block': blk.to_dict()})
    record('VULN' if r.status_code == 201 else 'BLOQUEADO',
           'Bloco com difficulty=0.5 (mínimo local=2)', f'{r.status_code}')

    # 2d. Timestamp antigo (10 dias)
    bc, app, c = fresh_app()
    blk = make_block(bc, [coinbase(Wallet().address)],
                     timestamp=time.time() - 10 * 86400)
    r = p2p_post(c, '/blocks/new', {'block': blk.to_dict()})
    record('VULN' if r.status_code == 201 else 'BLOQUEADO',
           'Bloco com timestamp de 10 dias atrás', f'{r.status_code}')

    # 2e. Mesma transação assinada duas vezes no mesmo bloco
    bc, app, c = fresh_app()
    src = Wallet()
    tx = Transaction(sender=src.public_key_pem, receiver=Wallet().address,
                     amount=300.0, fee=0.001, sender_address=src.address)
    tx.sign(src.private_key_pem)
    dup = Transaction.from_dict(tx.to_dict())
    blk = make_block(bc, [coinbase(src.address), tx, dup])
    r = p2p_post(c, '/blocks/new', {'block': blk.to_dict()})
    record('VULN' if r.status_code == 201 else 'BLOQUEADO',
           'Tx duplicada no mesmo bloco', f'{r.status_code}')

    # 2f. Bloco legítimo: agora usa o hash canônico (calculate_hash).
    bc, app, c = fresh_app()
    blk2 = Block(index=len(bc.chain), transactions=[coinbase(Wallet().address, 10.0)],
                 proof=0, previous_hash=bc.last_block.hash, difficulty=2)
    solve(blk2, 2, dual=False)
    r = p2p_post(c, '/blocks/new', {'block': blk2.to_dict()})
    body = r.get_data(as_text=True)
    record('OK' if r.status_code == 201 else 'FALHA',
           'Bloco legítimo aceito (hash canônico)',
           f'{r.status_code} {body[:60]}')

    # 2g. Bloco legítimo com o "lottery" duplo (controle positivo)
    bc, app, c = fresh_app()
    blk = make_block(bc, [coinbase(Wallet().address, 10.0)])
    r = p2p_post(c, '/blocks/new', {'block': blk.to_dict()})
    record('ACEITO' if r.status_code == 201 else 'FALHA',
           'Bloco que satisfaz os dois hashes (controle)', f'{r.status_code}')
    config.P2P_REQUIRE_SIGNATURE = previous_require


# ═══════════════════════════════════════════════════════════════════
# 3. SSRF no registro de peers
# ═══════════════════════════════════════════════════════════════════
def battery_ssrf():
    print('\n== 3. SSRF / registro de peers ==', flush=True)
    bc, app, c = fresh_app()
    targets = [
        ('loopback IPv4', 'http://127.0.0.1:5000'),
        ('RFC1918', 'http://10.0.0.5:5000'),
        ('metadata cloud', 'http://169.254.169.254/latest/meta-data/'),
        ('IPv6 loopback literal', 'http://[::1]:5000'),
        ('IPv4-mapped loopback', 'http://[::ffff:127.0.0.1]:5000'),
        ('IPv6 ULA', 'http://[fd00::1]:5000'),
        ('decimal loopback', 'http://2130706433:5000'),
        ('localhost alias nip.io', 'http://127.0.0.1.nip.io:5000'),
    ]
    for name, url in targets:
        r = p2p_post(c, '/nodes/register', {'nodes': [url]}, remote='198.51.100.20')
        ok = False
        try:
            data = r.get_json() or {}
            ok = url in (data.get('registered') or [])
        except Exception:
            pass
        if ok:
            record('VULN', f'SSRF registrado: {name}', url)
        else:
            record('BLOQUEADO', f'SSRF bloqueado: {name}', f'{r.status_code}')


# ═══════════════════════════════════════════════════════════════════
# 4. Rate limiting
# ═══════════════════════════════════════════════════════════════════
def battery_rate_limit():
    print('\n== 4. Rate limiting ==', flush=True)
    for lim in (rate_limiter, p2p_rate_limiter, mining_rate_limiter):
        lim._ip_clients.clear(); lim._wallet_clients.clear(); lim._rejection_count.clear()
    bc, app, c = fresh_app()
    ip = '203.0.113.50'
    codes = []
    for _ in range(61):
        codes.append(c.get('/api/peers', environ_base={'REMOTE_ADDR': ip}).status_code)
    allowed = codes.count(200)
    record('OK' if codes[-1] == 429 else 'FALHA',
           'Limite por IP aplicado', f'{allowed} x 200, último {codes[-1]}')

    # XFF forjado não deve abrir bucket novo
    r = c.get('/api/peers', environ_base={
        'REMOTE_ADDR': ip, 'HTTP_X_FORWARDED_FOR': '1.2.3.4'})
    record('BLOQUEADO' if r.status_code == 429 else 'VULN',
           'Bypass por X-Forwarded-For forjado', f'{r.status_code}')

    # Todos atrás do mesmo proxy compartilham o bucket
    r = c.get('/api/peers', environ_base={
        'REMOTE_ADDR': ip, 'HTTP_X_FORWARDED_FOR': '9.9.9.9'})
    record('VULN (DoS compartilhado)' if r.status_code == 429 else 'OK',
           'Usuário distinto atrás do mesmo proxy', f'{r.status_code}')

    # Memória: buckets nunca expiram
    before = len(rate_limiter._ip_clients)
    for i in range(5000):
        rate_limiter.is_allowed(f'10.9.{i // 250}.{i % 250}')
    after = len(rate_limiter._ip_clients)
    record('VULN' if after - before >= 5000 else 'OK',
           'Buckets de IP sem expiração', f'+{after - before} entradas')


# ═══════════════════════════════════════════════════════════════════
# 5. Path traversal no SPA
# ═══════════════════════════════════════════════════════════════════
def battery_traversal():
    print('\n== 5. Path traversal (catch-all do SPA) ==', flush=True)
    bc, app, c = fresh_app()
    payloads = [
        '/../config.py', '/%2e%2e/config.py', '/..%2fconfig.py',
        '/....//config.py', '/%2e%2e%5cconfig.py',
        '/C:/Windows/win.ini', '/%2e%2e%2f%2e%2e%2frequirements.txt',
    ]
    leaked = []
    for p in payloads:
        r = c.get(p)
        body = r.get_data(as_text=True)
        markers = ('FLASK', 'Flask', 'ecdsa==', 'TOTAL_SUPPLY_CAP', '[extensions]')
        if any(m in body for m in markers):
            leaked.append(p)
    record('VULN' if leaked else 'BLOQUEADO',
           'Leitura de arquivo fora de frontend/dist',
           f'vazou: {leaked}' if leaked else f'{len(payloads)} payloads sem vazamento')


# ═══════════════════════════════════════════════════════════════════
# 6. EVM JSON-RPC
# ═══════════════════════════════════════════════════════════════════
def battery_evm():
    print('\n== 6. EVM JSON-RPC ==', flush=True)
    try:
        from evm.engine import EVMEngine
        from evm.rpc import create_evm_blueprint
    except Exception as exc:
        record('SKIP', 'EVM indisponível', str(exc)[:60])
        return
    bc, app, c = fresh_app()
    with contextlib.redirect_stdout(SINK):
        engine = EVMEngine(auto_mine=True)
    app.register_blueprint(create_evm_blueprint(engine))

    r = c.post('/rpc', json={'jsonrpc': '2.0', 'id': 1,
                             'method': 'eth_sendRawTransaction', 'params': ['0xdeadbeef']})
    body = r.get_data(as_text=True)
    leak = any(m in body for m in ('Traceback', 'ValueError', 'RLP', 'File "'))
    record('VULN (detalhe interno)' if leak else 'OK',
           'Erro de execução do RPC vaza detalhe', f'{r.status_code} {body[:90]}')

    r = c.post('/rpc', json=[{'jsonrpc': '2.0', 'id': 1, 'method': 'eth_chainId'}])
    record('VULN' if r.status_code >= 500 else 'OK',
           'Batch JSON-RPC derruba a rota', f'{r.status_code}')

    r = c.post('/rpc', json={'jsonrpc': '2.0', 'id': 1,
                             'method': 'eth_feeHistory', 'params': ['0x7fffffff', 'latest']})
    record('VULN' if r.status_code >= 500 else 'OK',
           'eth_feeHistory com count absurdo', f'{r.status_code}')

    r = c.post('/rpc', json={'jsonrpc': '2.0', 'id': 1,
                             'method': 'eth_accounts', 'params': []},
               headers={'Origin': 'https://evil.example'})
    cors = r.headers.get('Access-Control-Allow-Origin')
    record('VULN' if cors in ('*', 'https://evil.example') else 'OK',
           'CORS do RPC aceita origem arbitrária', f'ACAO={cors}')


# ═══════════════════════════════════════════════════════════════════
# 7. Entradas e transações
# ═══════════════════════════════════════════════════════════════════
def battery_inputs():
    print('\n== 7. Entradas / transações ==', flush=True)
    bc, app, c = fresh_app()
    ip = '203.0.113.60'

    r = c.post('/transactions/new', data=b'x' * (200 * 1024),
               content_type='application/json',
               environ_base={'REMOTE_ADDR': ip})
    record('BLOQUEADO' if r.status_code == 413 else 'FALHA',
           'Payload de 200 KB', f'{r.status_code}')

    r = c.post('/transactions/new', data='[' * 50000,
               content_type='application/json',
               environ_base={'REMOTE_ADDR': ip})
    record('OK' if r.status_code in (400, 413, 415) else 'VULN',
           'JSON profundamente aninhado', f'{r.status_code}')

    # Carteira financiada
    wallet = Wallet()
    with contextlib.redirect_stdout(SINK):
        bc.mine_block(wallet.address)
    balance = bc.get_balance(wallet.address)

    # /transactions/new descarta o transaction_id, então qualquer tx assinada
    # pelo cliente é rejeitada. O caminho que funciona é create-signed.
    tx = Transaction(sender=wallet.public_key_pem, receiver=Wallet().address,
                     amount=1.0, fee=0.001, sender_address=wallet.address)
    tx.sign(wallet.private_key_pem)
    forged = tx.to_dict()
    forged['amount'] = 5.0
    r = c.post('/transactions/new', json=forged,
               environ_base={'REMOTE_ADDR': ip})
    record('BLOQUEADO' if r.status_code == 400 else 'VULN',
           '/transactions/new: amount adulterado', f'{r.status_code}')

    r = c.post('/transactions/new', json=tx.to_dict(),
               environ_base={'REMOTE_ADDR': ip})
    record('FALHA' if r.status_code == 400 else 'OK',
           '/transactions/new rejeita tx assinada legítima', f'{r.status_code}')

    def signed(amount, receiver=None):
        return c.post('/api/transactions/create-signed', json={
            'private_key_pem': wallet.private_key_pem,
            'receiver': (receiver or Wallet()).address,
            'amount': amount, 'fee': 0.001,
        }, environ_base={'REMOTE_ADDR': ip})

    r = signed(1.0)
    record('ACEITO (esperado)' if r.status_code == 201 else 'FALHA',
           'create-signed: transação legítima', f'{r.status_code}')

    r2 = signed(1.0)
    record('VULN' if r.status_code == 201 and r2.status_code == 201 else 'OK',
           'Double-submit idêntico sem idempotência',
           f'{r.status_code}/{r2.status_code}')

    r = signed(balance + 100)
    record('BLOQUEADO' if r.status_code == 400 else 'VULN',
           'Gasto acima do saldo', f'{r.status_code}')

    r = c.post('/transactions/new', json={'sender': '0', 'receiver': wallet.address,
                                          'amount': 1, 'fee': 0.001,
                                          'signature': 'aa'},
               environ_base={'REMOTE_ADDR': ip})
    record('BLOQUEADO' if r.status_code == 400 else 'VULN',
           'Coinbase criada via API', f'{r.status_code}')

    # Método errado no catch-all do SPA
    r = c.get('/mine', environ_base={'REMOTE_ADDR': ip})
    record('FALHA' if r.status_code == 200 and 'text/html' in r.headers.get('Content-Type', '')
           else 'OK', 'GET /mine deveria ser 405', f'{r.status_code}')

    # Parâmetros negativos/zero
    r = c.get('/api/transactions?per_page=0', environ_base={'REMOTE_ADDR': ip})
    record('VULN' if r.status_code >= 500 else 'OK',
           'per_page=0 derruba /api/transactions', f'{r.status_code}')


# ═══════════════════════════════════════════════════════════════════
# 8. Exposição de chave privada
# ═══════════════════════════════════════════════════════════════════
def battery_keys():
    print('\n== 8. Exposição de chave privada ==', flush=True)
    bc, app, c = fresh_app()
    ip = '203.0.113.70'
    os.environ['KURAMA_PRODUCTION'] = 'false'
    r = c.post('/wallet/new', environ_base={'REMOTE_ADDR': ip})
    data = r.get_json() or {}
    leaked = 'private_key_pem' in data
    record('VULN (dev)' if leaked else 'BLOQUEADO',
           'Modo dev sem opt-in devolve chave privada',
           f'{r.status_code} chaves={[k for k in ("private_key_pem",) if k in data]}')

    os.environ['KURAMA_PRODUCTION'] = 'true'
    r = c.post('/wallet/new', environ_base={'REMOTE_ADDR': ip})
    data = r.get_json() or {}
    leaked_prod = 'private_key_pem' in data
    record('BLOQUEADO' if not leaked_prod else 'VULN',
           'Modo produção expõe chave privada', f'{r.status_code}')
    os.environ['KURAMA_PRODUCTION'] = 'false'


def main():
    print('KuramaChain — sonda de segurança local', flush=True)
    print(f'NETWORK_SECRET configurado: {bool(NETWORK_SECRET)} '
          f'({len(NETWORK_SECRET)} chars)', flush=True)
    battery_auth()
    battery_block_forgery()
    battery_ssrf()
    battery_rate_limit()
    battery_traversal()
    battery_evm()
    battery_inputs()
    battery_keys()

    print('\n== RESUMO ==', flush=True)
    counts = {}
    for verdict, _, _ in RESULTS:
        counts[verdict] = counts.get(verdict, 0) + 1
    for verdict, n in sorted(counts.items()):
        print(f'{verdict}: {n}', flush=True)
    vulns = [r for r in RESULTS if r[0].startswith(('VULN', 'FALHA'))]
    print(f'\nTotal de achados exploráveis: {len(vulns)}', flush=True)
    for verdict, name, detail in vulns:
        print(f'  - {name} ({detail})', flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
