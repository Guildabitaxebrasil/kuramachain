"""
API REST da Blockchain.
Fornece endpoints HTTP para interagir com a blockchain.

Endpoints:
  GET  /chain              - Visualizar blockchain completa
  POST /mine               - Minerar um novo bloco
  POST /transactions/new   - Criar nova transação
  POST /wallet/new         - Criar nova carteira
  GET  /balance/<address>  - Consultar saldo
  POST /nodes/register     - Registrar nós vizinhos
  POST /nodes/resolve      - Executar consenso
  GET  /validate           - Validar blockchain
  GET  /stats              - Estatísticas da blockchain
  GET  /api/events         - SSE: Eventos em tempo real da blockchain
  GET  /api/docs           - Documentação Swagger/OpenAPI

Endpoints Explorer (/api/*):
  GET  /api/health              - Health check
  GET  /api/chain/since/<index> - Blocos a partir do índice
  GET  /api/blocks/<identifier> - Bloco por index ou hash
  GET  /api/transactions        - Transações (paginação/filtros)
  GET  /api/search?q=<term>     - Busca unificada
  GET  /api/nodes               - Lista nós com status
  POST /api/nodes/sync          - Trigger de consenso
  GET  /api/chart               - Dados para gráfico do Dashboard
  GET  /api/mempool             - Estatísticas da mempool

Endpoints de Rede (P2P):
  POST /blocks/new              - Receber novo bloco de outro nó
"""
from flask import Flask, jsonify, request, Response, g, stream_with_context, make_response as _flask_make_response
from flask_cors import CORS
import requests
import json
import base64
import ipaddress
import socket
import time
import threading
import urllib.parse
import urllib3
import queue
from functools import wraps
from flasgger import Swagger

from core.crypto_utils import CryptoUtils
from core.mnemonic import (
    generate_mnemonic, is_valid_mnemonic, private_key_pem_from_mnemonic,
)
from core.transaction import Transaction
from core.wallet import Wallet
from core.blockchain import Blockchain
import os
from config import (
    CORS_ORIGINS, CA_CERT_FILE, NODE_AUTH_HEADER, NETWORK_SECRET,
    SSL_CERT_DIR, P2P_SIGNATURE_HEADER, P2P_PUBKEY_HEADER,
    P2P_REQUIRE_SIGNATURE, TARGET_BLOCK_TIME, TRUST_PROXY_HEADERS,
    P2P_TIMESTAMP_HEADER, P2P_NONCE_HEADER, P2P_MAX_CLOCK_DRIFT,
    P2P_MAX_PEERS, P2P_ALLOWED_PORTS, DEV_EXPOSE_KEYS,
)

# ─── Suprime warnings SSL para certs auto-assinados (dev) ──────
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ─── Helper: Detecção de Modo Produção ──────────────────────────
def _is_production_mode() -> bool:
    """Verifica se o servidor está em modo produção."""
    return os.environ.get('KURAMA_PRODUCTION', '').lower() in ('1', 'true', 'yes')


def _dev_keys_enabled() -> bool:
    """Só devolve chave privada com opt-in explícito e fora de produção."""
    return not _is_production_mode() and bool(DEV_EXPOSE_KEYS)


def _normalize_ip(value) -> str | None:
    """Normaliza um IP, desembrulhando IPv4 mapeado em IPv6."""
    try:
        ip = ipaddress.ip_address(str(value).split('%', 1)[0])
    except (TypeError, ValueError):
        return None
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return str(ip)


def _is_public_ip(value) -> bool:
    """Aceita apenas IPs globalmente roteáveis (anti-SSRF)."""
    normalized = _normalize_ip(value)
    if not normalized:
        return False
    ip = ipaddress.ip_address(normalized)
    return ip.is_global and not ip.is_multicast


def _resolve_public_peer(url: str):
    """
    Valida URL de peer: esquema, porta permitida e IPs públicos.

    Resolve o DNS e exige que TODOS os endereços sejam públicos —
    um host que mistura IP público e privado é recusado (DNS rebinding).

    Returns:
        (hostname, resolved_ip, erro). erro=None em caso de sucesso.
    """
    try:
        parsed = urllib.parse.urlparse(url)
    except ValueError:
        return None, None, 'URL inválida'

    if parsed.scheme not in ('http', 'https'):
        return None, None, 'esquema não permitido'
    if parsed.username or parsed.password:
        return None, None, 'credenciais na URL não permitidas'

    hostname = parsed.hostname
    if not hostname:
        return None, None, 'host ausente'

    try:
        port = parsed.port or (443 if parsed.scheme == 'https' else 80)
    except ValueError:
        return None, None, 'porta inválida'
    if port not in P2P_ALLOWED_PORTS:
        return None, None, f'porta {port} não permitida'

    try:
        infos = socket.getaddrinfo(
            hostname, port, type=socket.SOCK_STREAM
        )
    except (OSError, UnicodeError):
        return None, None, 'DNS não resolve'

    resolved = []
    for info in infos:
        raw_ip = info[4][0]
        normalized = _normalize_ip(raw_ip)
        if not normalized or not _is_public_ip(normalized):
            return None, None, f'IP não público: {raw_ip}'
        if normalized not in resolved:
            resolved.append(normalized)

    if not resolved:
        return None, None, 'nenhum IP resolvido'
    return hostname, resolved[0], None


def _decode_p2p_public_key(raw: str | None) -> str | None:
    """Decodifica a pubkey PEM enviada em Base64 (header HTTP)."""
    if not raw:
        return None
    raw = raw.strip()
    if 'BEGIN PUBLIC KEY' in raw:
        return raw
    try:
        decoded = base64.b64decode(raw, validate=True).decode('utf-8')
    except (ValueError, UnicodeDecodeError):
        return None
    return decoded if 'BEGIN PUBLIC KEY' in decoded else None


def _p2p_payload() -> dict:
    """Payload P2P já descriptografado por require_p2p_nonce."""
    cached = g.get('p2p_payload')
    if cached is not None:
        return cached
    return request.get_json(silent=True) or {}


# ─── Rate Limiter Multi-Camada ────────────────────────────────────
# Rate limit por IP + wallet address + adaptativo por rejeições.
# Previne abuso distribuído (botnet) e waste de CPU via ECDSA verify.
class AdvancedRateLimiter:
    """
    Rate limiter multi-camada para proteção de produção.

    Camadas:
    1. Por IP: limite base por endereço IP
    2. Por wallet: limite por endereço de carteira (anti-botnet)
    3. Adaptativo: IPs com muitas rejeições têm limite reduzido
    4. Suporta X-Forwarded-For para proxies reversos

    Evita vazamento de memória com:
    - TTL nos buckets de IP (eviction automática após window_seconds)
    - Limite máximo de buckets (cap); IPs com mais de MAX_REJECTIONS
      entram em cooldown gradual com decaimento da penalidade.
    """

    # Evitando vazamento de memória: número máximo de IPs rastreados.
    # IPs que excederem este limite e estiverem inativos são evictados.
    MAX_IP_BUCKETS = 10000
    MAX_REJECTIONS_BEFORE_COOLDOWN = 12  # penalidade máxima antes de reset

    def __init__(self, max_requests: int = 60, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._ip_clients: dict = {}  # ip -> list of timestamps
        self._wallet_clients: dict = {}  # wallet -> list of timestamps
        self._rejection_count: dict = {}  # ip -> count
        self._lock = threading.Lock()

    def _evict_expired_buckets(self, now: float):
        """Remove buckets de IP inativos para evitar vazamento de memória."""
        # Evita iterar sobre todos os IPs se houver poucos buckets
        if len(self._ip_clients) > self.MAX_IP_BUCKETS:
            expired_ips = [
                ip for ip, timestamps in self._ip_clients.items()
                if not timestamps or (now - timestamps[-1]) > self.window_seconds * 2
            ]
            for ip in expired_ips:
                del self._ip_clients[ip]
                self._rejection_count.pop(ip, None)

    def is_allowed(self, ip: str, wallet: str = None) -> bool:
        now = time.time()
        with self._lock:
            # Eviction de buckets inativos para controle de memória
            self._evict_expired_buckets(now)

            # Penalidade adaptativa com decaimento: IPs com muitas rejeições
            # têm limite reduzido, mas a penalidade decai com o tempo.
            rejections = self._rejection_count.get(ip, 0)
            # Decaimento: reduz penalidade após window_seconds sem rejeições
            if rejections > 0 and (now - self._rejection_count.get(f'{ip}_last', 0)) > self.window_seconds:
                # Gradualmente reduz a penalidade (metade a cada janela)
                decay_factor = max(1, rejections // 2)
                self._rejection_count[ip] = decay_factor
                rejections = decay_factor
            effective_max = max(1, self.max_requests - rejections * 5)

            # Rate limit por IP
            if ip not in self._ip_clients:
                self._ip_clients[ip] = []
            self._ip_clients[ip] = [
                t for t in self._ip_clients[ip]
                if now - t < self.window_seconds
            ]
            if len(self._ip_clients[ip]) >= effective_max:
                return False

            # Rate limit por wallet (se fornecido)
            if wallet:
                if wallet not in self._wallet_clients:
                    self._wallet_clients[wallet] = []
                self._wallet_clients[wallet] = [
                    t for t in self._wallet_clients[wallet]
                    if now - t < self.window_seconds
                ]
                # Wallet: 10 req/min (anti-botnet)
                if len(self._wallet_clients[wallet]) >= 10:
                    return False

            self._ip_clients[ip].append(now)
            if wallet:
                self._wallet_clients[wallet].append(now)
            return True

    def register_rejection(self, ip: str):
        """Incrementa contagem de rejeições para rate limit adaptativo.
        
        Após MAX_REJECTIONS_BEFORE_COOLDOWN rejeições, o IP entra em
        cooldown com penalidade máxima. A penalidade decai com o tempo.
        """
        with self._lock:
            current = self._rejection_count.get(ip, 0)
            # Limita o número de rejeições registradas para evitar penalidade infinita
            if current < self.MAX_REJECTIONS_BEFORE_COOLDOWN:
                self._rejection_count[ip] = current + 1
            # Registra timestamp da última rejeição para decaimento
            self._rejection_count[f'{ip}_last'] = time.time()

rate_limiter = AdvancedRateLimiter(max_requests=60, window_seconds=60)

# Mineração externa tem cota própria. O minerador faz duas requisições por
# bloco (template + submit); no limite global de 60/min ele seria bloqueado
# depois de ~30 blocos. Continua limitado (cliente abusivo é barrado), mas
# com folga para minerar no ritmo da rede.
mining_rate_limiter = AdvancedRateLimiter(max_requests=600, window_seconds=60)


# ─── SSE Event Manager ────────────────────────────────────────────
# Gerencia assinantes de eventos Server-Sent Events (SSE).
# Permite que o frontend receba atualizacoes em tempo real sem polling.
class SSEEventManager:
    """
    Gerenciador de eventos Server-Sent Events.

    Mantem uma lista de filas (uma por cliente SSE) e publica
    eventos para todos os assinantes quando algo muda na blockchain.
    """

    def __init__(self):
        self._subscribers: list[queue.Queue] = []
        self._lock = threading.Lock()

    def subscribe(self) -> queue.Queue:
        """Cria uma nova fila para um assinante SSE."""
        q: queue.Queue = queue.Queue()
        with self._lock:
            self._subscribers.append(q)
        return q

    def unsubscribe(self, q: queue.Queue):
        """Remove um assinante."""
        with self._lock:
            if q in self._subscribers:
                self._subscribers.remove(q)

    def publish(self, event_type: str, data: dict):
        """Publica um evento para todos os assinantes ativos."""
        with self._lock:
            dead: list[queue.Queue] = []
            for q in self._subscribers:
                try:
                    q.put_nowait({'event': event_type, 'data': data})
                except queue.Full:
                    dead.append(q)
            # Remove filas cheias (cliente lento/desconectado)
            for q in dead:
                self._subscribers.remove(q)

    @property
    def subscriber_count(self) -> int:
        with self._lock:
            return len(self._subscribers)

sse_manager = SSEEventManager()


# ─── Rate Limiter P2P (por peer) ──────────────────────────────
# Rate limit distribuído por identidade de peer (node_id).
# Cada peer tem limite independente do rate limit de IP.
from config import P2P_RATE_LIMIT as _P2P_LIMIT
p2p_rate_limiter = AdvancedRateLimiter(
    max_requests=_P2P_LIMIT,
    window_seconds=60
)

# ─── P2P Nonce Manager (anti-replay) ──────────────────────────
# Cache LRU com 100k entradas, TTL de 5 min.
from config import P2P_NONCE_CACHE_SIZE, P2P_NONCE_TTL, P2P_MAX_CLOCK_DRIFT
from core.p2p_security import P2PNonceManager, PeerScoreManager
p2p_nonce_manager = P2PNonceManager(
    max_size=P2P_NONCE_CACHE_SIZE,
    ttl=P2P_NONCE_TTL,
    max_clock_drift=P2P_MAX_CLOCK_DRIFT
)

# ─── Peer Score Manager ───────────────────────────────────────
from config import P2P_PEER_SCORE_BAN_THRESHOLD as _BAN_THRESH
from config import P2P_PEER_SCORE_BAN_BASE as _BAN_BASE
from config import P2P_PEER_SCORE_BAN_MAX as _BAN_MAX
peer_score_manager = PeerScoreManager(
    ban_threshold=_BAN_THRESH,
    ban_base_seconds=_BAN_BASE,
    ban_max_seconds=_BAN_MAX
)

def _get_client_ip() -> str:
    """
    Obtém o IP do cliente para rate limiting.

    X-Forwarded-For é aceito SOMENTE quando TRUST_PROXY_HEADERS=true
    (nó atrás de um proxy reverso conhecido). Sem isso, qualquer
    cliente forja o header com um IP aleatório por requisição e anula
    o rate limit por IP — o header é escolhido pelo atacante, não um
    dado de confiança.
    """
    if TRUST_PROXY_HEADERS:
        forwarded = request.headers.get('X-Forwarded-For', '')
        if forwarded:
            # O último IP é o adicionado pelo proxy mais próximo, que
            # é o único confiável quando há uma cadeia de proxies.
            return forwarded.split(',')[-1].strip()
    return request.remote_addr or 'unknown'

def _verified_request(method: str, url: str, **kwargs) -> requests.Response:
    """
    Faz requisição HTTPS com verificação de certificado via CA.

    Em MODO PRODUÇÃO (KURAMA_PRODUCTION=1), FAIL HARD se CA não
    existe — sem fallback inseguro. Em dev, aviso de MITM.

    Args:
        method: 'GET' ou 'POST'
        url: URL completa
        **kwargs: Argumentos adicionais

    Returns:
        Response object
    """
    kwargs.setdefault('timeout', 2)

    if os.path.exists(CA_CERT_FILE):
        kwargs['verify'] = CA_CERT_FILE
    elif os.environ.get('KURAMA_PRODUCTION', '').lower() in ('1', 'true', 'yes'):
        raise RuntimeError(
            "MODO PRODUÇÃO: CA_CERT_FILE não encontrado. "
            "Gere a CA e configure certs/ca.pem"
        )
    else:
        import warnings
        warnings.warn(
            "[WARN] verify=False: MITM vulnerável! "
            f"Configure CA em {CA_CERT_FILE}",
            RuntimeWarning, stacklevel=2
        )
        kwargs['verify'] = False

    # mTLS: certificado de cliente se configurado
    client_cert = os.environ.get('KURAMA_CLIENT_CERT')
    client_key = os.environ.get('KURAMA_CLIENT_KEY')
    if client_cert and client_key and os.path.exists(client_cert) and os.path.exists(client_key):
        kwargs['cert'] = (client_cert, client_key)

    # ─── Corpo exato + HMAC-SHA256 v2 (autenticação P2P) ────────
    # Serializamos o JSON nós mesmos para que o MAC cubra exatamente os
    # bytes que viajam no fio (com json= o requests escolhe a formatação
    # e o MAC do receptor não fecha). O MAC cobre método, caminho, 
    # timestamp e nonce — ver CryptoUtils.p2p_request_mac.
    headers = kwargs.setdefault('headers', {})
    body_data = kwargs.pop('json', None)
    if body_data is not None:
        kwargs['data'] = json.dumps(body_data).encode('utf-8')
        headers.setdefault('Content-Type', 'application/json')
    body_data = kwargs.get('data', b'')
    if isinstance(body_data, str):
        body_data = body_data.encode('utf-8')
    elif isinstance(body_data, dict):
        body_data = json.dumps(body_data, sort_keys=True).encode('utf-8')
    # Sem secret compartilhado não há headers de auth (o par recusa).
    if NETWORK_SECRET:
        headers.update(_p2p_auth_headers(method, url, body_data))

    if method.upper() == 'GET':
        return requests.get(url, **kwargs)
    elif method.upper() == 'POST':
        return requests.post(url, **kwargs)
    else:
        raise ValueError(f"Método HTTP inválido: {method}")

def _p2p_auth_headers(method: str, url: str, body: bytes) -> dict:
    """
    Monta os headers de autenticação P2P de uma requisição de saída.

    O MAC cobre método, caminho, timestamp e nonce além do corpo, e o
    nonce é único por requisição. Sem o vínculo temporal/por-requisição,
    um POST capturado podia ser reenviado verbatim (replay).

    Args:
        method: Método HTTP
        url: URL completa
        body: Corpo bruto da requisição

    Returns:
        Dict de headers

    Raises:
        RuntimeError: Se NETWORK_SECRET não está configurado
    """
    if not NETWORK_SECRET:
        raise RuntimeError(
            "NETWORK_SECRET não configurado: requisições P2P não são "
            "autenticadas e serão recusadas pelo par."
        )
    import urllib.parse
    path = urllib.parse.urlparse(url).path or '/'
    timestamp = str(int(time.time()))
    nonce = CryptoUtils.generate_p2p_nonce()
    mac = CryptoUtils.p2p_request_mac(
        NETWORK_SECRET, method, path, timestamp, nonce, body or b''
    )
    return {
        NODE_AUTH_HEADER: mac,
        P2P_TIMESTAMP_HEADER: timestamp,
        P2P_NONCE_HEADER: nonce,
    }


def _require_p2p_hmac(f):
    """
    Decorator que exige autenticação P2P via HMAC-SHA256 entre nós.

    SEGURANÇA:
    1. O secret NUNCA viaja — apenas o MAC derivado dele
    2. O MAC cobre método + caminho + timestamp + nonce + corpo:
       um MAC capturado não pode ser reaproveitado em outra rota,
       em outro método nem depois da janela de relógio
    3. O nonce é consumido no cache anti-replay (LRU + TTL): reenvio
       da mesma requisição é rejeitado
    4. A comparação é feita em TEMPO CONSTANTE (hmac.compare_digest)
    5. Fail-closed: sem NETWORK_SECRET, tudo é recusado

    Uso:
        @app.route('/blocks/new', methods=['POST'])
        @_require_p2p_hmac
        def receive_block():
            ...
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        if not NETWORK_SECRET:
            return jsonify({
                'error': 'Acesso P2P não autorizado. NETWORK_SECRET ausente.'
            }), 401

        auth_header = request.headers.get(NODE_AUTH_HEADER, '')
        timestamp = request.headers.get(P2P_TIMESTAMP_HEADER, '')
        nonce = request.headers.get(P2P_NONCE_HEADER, '')
        if not auth_header or not timestamp or not nonce:
            return jsonify({
                'error': 'Acesso P2P não autorizado. Headers de '
                         'autenticação ausentes.'
            }), 401

        try:
            ts_value = float(timestamp)
        except (TypeError, ValueError):
            return jsonify({'error': 'Timestamp P2P inválido.'}), 401

        if abs(time.time() - ts_value) > P2P_MAX_CLOCK_DRIFT:
            return jsonify({
                'error': 'Requisição P2P fora da janela de relógio.'
            }), 401

        expected = CryptoUtils.p2p_request_mac(
            NETWORK_SECRET, request.method, request.path, timestamp,
            nonce, request.get_data()
        )
        if not CryptoUtils.hash_equals(expected, auth_header):
            return jsonify({
                'error': 'Acesso P2P não autorizado. HMAC inválido.'
            }), 401

        # Anti-replay: consome o nonce só depois de autenticar o MAC.
        ok, reason = p2p_nonce_manager.validate_message({
            '_nonce': nonce,
            '_timestamp': ts_value,
            '_expires': ts_value + P2P_MAX_CLOCK_DRIFT,
        })
        if not ok:
            return jsonify({'error': f'Requisição P2P rejeitada: {reason}'}), 401

        return f(*args, **kwargs)
    return decorated

# Alias para compatibilidade com código existente
_require_p2p_auth = _require_p2p_hmac

def rate_limit(f):
    """Decorator que aplica rate limiting multi-camada (IP + wallet).
    
    Adiciona headers X-RateLimit-* em todas as respostas para
    que os clientes saibam seus limites (M-01).
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        ip = _get_client_ip()
        wallet = None
        if request.is_json:
            data = request.get_json(silent=True) or {}
            if 'sender' in data:
                wallet = data.get('sender')
            elif 'sender_address' in data:
                wallet = data.get('sender_address')

        if not rate_limiter.is_allowed(ip, wallet):
            response = jsonify({
                'error': 'Muitas requisições. Aguarde e tente novamente.',
                'retry_after': 60
            })
            response.status_code = 429
            response.headers['Retry-After'] = '60'
            return response

        try:
            response = f(*args, **kwargs)
        except Exception as e:
            rate_limiter.register_rejection(ip)
            raise e

        # ─── X-RateLimit Headers (M-01) ────────────────────────
        if isinstance(response, tuple):
            response = _flask_make_response(response)
        if hasattr(response, 'headers'):
            response.headers['X-RateLimit-Limit'] = str(rate_limiter.max_requests)
            response.headers['X-RateLimit-Window'] = str(rate_limiter.window_seconds)
            response.headers['X-RateLimit-Policy'] = 'ip;w=' + str(rate_limiter.window_seconds)

        return response
    return decorated


def rate_limit_mining(f):
    """Rate limit das rotas de mineração externa (/mining/*).

    Usa a cota de mineração em vez da global: sem isso o próprio minerador
    toma 429 ao emendar blocos (2 requisições por bloco). Os headers
    X-RateLimit-* continuam anunciando o limite aplicado.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        ip = _get_client_ip()
        if not mining_rate_limiter.is_allowed(ip):
            return jsonify({
                'error': 'Muitas requisições de mineração. Aguarde e tente novamente.',
                'retry_after': 60
            }), 429

        try:
            response = f(*args, **kwargs)
        except Exception as e:
            mining_rate_limiter.register_rejection(ip)
            raise e

        if isinstance(response, tuple):
            response = _flask_make_response(response)
        if hasattr(response, 'headers'):
            response.headers['X-RateLimit-Limit'] = str(mining_rate_limiter.max_requests)
            response.headers['X-RateLimit-Window'] = str(mining_rate_limiter.window_seconds)
            response.headers['X-RateLimit-Policy'] = 'ip;w=' + str(mining_rate_limiter.window_seconds)

        return response
    return decorated


# ─── Rate Limit P2P (por peer) ─────────────────────────────────
# Similar ao rate_limit mas usa o p2p_rate_limiter (por peer_id).
# Uso: endpoints P2P (/blocks/new, /nodes/register, /nodes/resolve)
def rate_limit_peer(f):
    """Rate limit para requisições P2P baseado em node_id."""
    @wraps(f)
    def decorated(*args, **kwargs):
        peer_id = request.headers.get(P2P_PUBKEY_HEADER, _get_client_ip())
        if not p2p_rate_limiter.is_allowed(peer_id):
            response = jsonify({
                'error': 'Rate limit P2P excedido. Aguarde.',
                'retry_after': 60
            })
            response.status_code = 429
            response.headers['Retry-After'] = '60'
            return response
        try:
            response = f(*args, **kwargs)
            return response
        except Exception as e:
            p2p_rate_limiter.register_rejection(peer_id)
            raise e
    return decorated


# ─── P2P Nonce Validation (anti-replay) ────────────────────────
# Verifica nonce + timestamp + expiração em mensagens P2P.
# Previne replay attacks: mesma mensagem reenviada = rejeitada.
def _decrypt_p2p_payload(data: dict) -> dict:
    """
    Descriptografa o envelope AEAD (AES-256-GCM) de um payload P2P.

    O remetente pode envelopar o JSON em {_encrypted, _ciphertext,
    _nonce}. A chave é derivada de NETWORK_SECRET e o AAD é o caminho
    da rota. Payload sem envelope é devolvido como está.

    Args:
        data: Payload recebido

    Returns:
        Payload em texto claro

    Raises:
        ValueError: Se o envelope estiver adulterado/incompleto
    """
    if not isinstance(data, dict) or not data.get('_encrypted'):
        return data

    from config import P2P_ENCRYPTION
    if not P2P_ENCRYPTION:
        return data

    import hashlib
    if not NETWORK_SECRET:
        raise ValueError('NETWORK_SECRET ausente para descriptografar payload')
    enc_key = hashlib.sha256(NETWORK_SECRET.encode('utf-8')).digest()
    try:
        ciphertext = base64.b64decode(data['_ciphertext'])
        enc_nonce = base64.b64decode(data['_nonce'])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError('Envelope P2P incompleto') from exc

    plaintext = CryptoUtils.aes256gcm_decrypt(
        enc_key, enc_nonce, ciphertext, request.path.encode('utf-8')
    )
    return json.loads(plaintext.decode('utf-8'))


def require_p2p_nonce(f):
    """Descriptografa o payload P2P e o disponibiliza para a rota.

    O anti-replay é feito pelo nonce do HEADER, consumido em
    _require_p2p_hmac (que também assina método/caminho/corpo). O
    envelope opcional do corpo (_nonce/_timestamp/_expires) não é
    exigido nem consumido de novo: exigir um segundo nonce rejeitava
    o cliente oficial (que só envia o nonce do header) e permitia
    replay quando os dois nonces coincidiam.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        try:
            data = _decrypt_p2p_payload(request.get_json(silent=True) or {})
        except ValueError as e:
            return jsonify({'error': f'Payload P2P inválido: {e}'}), 401
        g.p2p_payload = data
        return f(*args, **kwargs)
    return decorated


def create_app(blockchain: Blockchain = None, node_address: str = None,
               port: int = 5000, mining_cooldown: float = None) -> Flask:
    """
    Cria e configura a aplicação Flask.

    Args:
        blockchain: Instância da blockchain (criada se None)
        node_address: Endereço do nó (carteira do minerador)
        port: Porta do servidor
        mining_cooldown: Intervalo mínimo entre blocos em segundos
            (None = alvo da rede, 600s = 10 min; 0 desliga a checagem)

    Returns:
        Aplicação Flask configurada
    """
    app = Flask(__name__)
    app.config['MAX_CONTENT_LENGTH'] = 1024 * 100  # 100 KB max payload
    CORS(app, origins=CORS_ORIGINS)

    # ─── Swagger / OpenAPI ─────────────────────────────────────
    app.config['SWAGGER'] = {
        'title': 'KuramaChain API',
        'description': '''
API REST da Blockchain Kurama.

Endpoints principais:
- **/chain** — Visualizar blockchain completa
- **/mine** — Minerar um novo bloco (Proof of Work)
- **/transactions/new** — Criar nova transação
- **/wallet/new** — Gerar nova carteira
- **/balance/<endereço>** — Consultar saldo
- **/stats** — Estatísticas da blockchain
- **/api/events** — Eventos em tempo real (SSE)

Documentação completa dos endpoints e schemas.
''',
        'version': '1.0.0',
        'termsOfService': '',
        'hide_top_bar': True,
    }
    if _is_production_mode():
        app.config['SWAGGER'] = {'hide_top_bar': True, 'title': ''}
    Swagger(app)

    # ─── Security Headers + Error Sanitization ────────────────
    @app.after_request
    def add_security_headers(response):
        """Adiciona headers de segurança em todas as respostas HTTP e sanitiza erros."""
        # Sanitização de erros: remove detalhes internos das mensagens
        # para prevenir vazamento de informações de implementação.
        if response.status_code >= 500 and response.is_json:
            try:
                data = response.get_json()
                if data and 'error' in data:
                    # Substitui mensagem de erro por versão genérica
                    data['error'] = 'Erro interno do servidor'
                    response.set_data(json.dumps(data))
            except Exception:
                pass
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['X-XSS-Protection'] = '1; mode=block'
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate'
        # Content-Security-Policy: restritivo para prevenir XSS
        response.headers['Content-Security-Policy'] = (
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "connect-src 'self'; "
            "img-src 'self' data:; "
            "frame-ancestors 'none'"
        )
        # Strict-Transport-Security: força HTTPS no navegador (1 ano)
        response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
        # Referrer-Policy: não enviar referer em requisições cross-origin
        response.headers['Referrer-Policy'] = 'no-referrer'
        return response

    # Estado da aplicação
    app.blockchain = blockchain or Blockchain(difficulty=4)

    # Intervalo mínimo entre blocos (s). None = alvo da rede (600s = 10 min);
    # 0 desliga a checagem (usado nos testes, que mineram em sequência).
    app.mining_cooldown = (
        TARGET_BLOCK_TIME if mining_cooldown is None else float(mining_cooldown)
    )

    # ─── Ritmo de blocos (alvo de 10 minutos) ────────────────────
    # Como no Bitcoin, um bloco novo só pode ser minerado a cada
    # `app.mining_cooldown` segundos contados do topo da cadeia. Sem isso o
    # minerador automático fecha um bloco por segundo e a recompensa vira
    # torneira aberta. O gênese (timestamp 0) não conta: a primeira mineração
    # é livre.
    def _seconds_until_next_block() -> float:
        """Quanto falta (s) para liberar o próximo bloco. 0 = pode minerar."""
        return app.blockchain.seconds_until_next_block(
            getattr(app, 'mining_cooldown', TARGET_BLOCK_TIME))

    def _block_cooldown_response(wait: float):
        """Resposta 429 dizendo quanto falta para o próximo bloco."""
        return jsonify({
            'error': 'Ritmo de blocos: o último bloco foi minerado ainda há '
                     'pouco. Aguarde o intervalo alvo antes de minerar.',
            'retry_after': round(wait, 1),
            'next_block_at': time.time() + wait,
            'target_block_time': getattr(app, 'mining_cooldown',
                                         TARGET_BLOCK_TIME),
        }), 429

    # Nós vizinhos na rede (URLs base)
    # Dict: {url: {resolved_ip, registered_at, last_seen}}
    # Armazena IP resolvido para prevenir DNS rebinding attacks.
    app.nodes = {}

    def _get_node_urls():
        """Retorna lista de URLs de nós registrados."""
        return list(app.nodes.keys())

    def _is_node_registered(url: str) -> bool:
        """Verifica se URL já está registrada."""
        return url in app.nodes

    def _validate_node_dns(url: str, node_info: dict) -> bool:
        """
        Anti-DNS Rebinding: re-resolve o hostname e compara com o IP registrado.
        Se o DNS mudou desde o registro, a requisição é rejeitada.

        Args:
            url: URL do nó
            node_info: Dict com resolved_ip do registro

        Returns:
            True se o DNS ainda resolve para o mesmo IP
        """
        if not node_info:
            return False
        # Peers locais criados pelo NodeManager (mesmo processo) não
        # passam por /nodes/register e podem usar loopback.
        if node_info.get('trusted'):
            return True
        try:
            parsed = urllib.parse.urlparse(url)
            hostname = parsed.hostname or ''
            if not hostname:
                return False
            port = parsed.port or (443 if parsed.scheme == 'https' else 80)
            if port not in P2P_ALLOWED_PORTS:
                return False
            stored = _normalize_ip(node_info.get('resolved_ip'))
            if not stored:
                return False
            current_ips = socket.getaddrinfo(
                hostname, port, type=socket.SOCK_STREAM
            )
            found = False
            for addr_info in current_ips:
                current_ip = _normalize_ip(addr_info[4][0])
                # Se o DNS passou a apontar para qualquer IP não público,
                # recusa o peer inteiro (proteção contra DNS rebinding).
                if not current_ip or not _is_public_ip(current_ip):
                    return False
                if current_ip == stored:
                    found = True
            return found
        except Exception:
            return False

    # Carteira do nó (para receber recompensas de mineração)
    # A chave privada NUNCA é armazenada no objeto Flask.
    # A wallet completa (com chave) é gerenciada pelo NodeManager.
    if node_address:
        app.node_wallet_address = node_address
    else:
        wallet = Wallet()
        app.node_wallet_address = wallet.address
        # A chave privada fica apenas na instância Wallet,
        # NUNCA exposta via atributos do app Flask.

    # ─── Rotas da API ────────────────────────────────────────────

    @app.route('/chain', methods=['GET'])
    def get_chain():
        """
        Retorna a blockchain completa.
        Endpoint principal para visualizar todos os blocos e transações.
        """
        response = {
            'chain': [block.to_dict() for block in app.blockchain.chain],
            'length': len(app.blockchain.chain),
            'pending_transactions': [
                tx.to_dict() for tx in app.blockchain.pending_transactions
            ],
            'node_id': app.blockchain.node_id,
            'difficulty': app.blockchain.difficulty
        }
        return jsonify(response), 200

    @app.route('/mine', methods=['POST'])
    @rate_limit
    def mine():
        """
        Minera um novo bloco.
        Executa o Proof of Work e recompensa o minerador com coins.

        A transação coinbase (recompensa) é adicionada automaticamente
        ao bloco durante a mineração — mesmo que não haja transações
        pendentes, o minerador recebe a recompensa do bloco.

        Body (JSON) opcional:
            miner_address: Endereço do minerador para receber a recompensa.
                          Se não fornecido, usa o endereço do nó.

        Exemplos:
            POST /mine                        → minera para o endereço do nó
            POST /mine {"miner_address": "15ZK..."}  → minera para seu endereço
        """
        # Aceita miner_address opcional no body da requisição
        data = request.get_json(silent=True) or {}
        miner_address = data.get('miner_address', app.node_wallet_address)

        # Valida o endereço fornecido
        if miner_address != app.node_wallet_address:
            if not CryptoUtils.is_valid_address(miner_address):
                return jsonify({
                    'error': f'Endereço de minerador inválido: {miner_address[:30]}...',
                    'hint': 'Forneça um endereço Base58 Kurama válido ou deixe vazio para usar o endereço do nó.'
                }), 400

        # Ritmo de blocos: a recompensa só é paga a cada 10 minutos.
        wait = _seconds_until_next_block()
        if wait > 0:
            return _block_cooldown_response(wait)

        # Executa a mineração (a coinbase é inserida automaticamente
        # pelo mine_block(), mesmo com mempool vazia)
        block = app.blockchain.mine_block(miner_address)

        if not block:
            return jsonify({'message': 'Falha ao minerar bloco'}), 500

        # Extrai info da coinbase
        coinbase_tx = block.transactions[0] if block.transactions else None
        total_reward = coinbase_tx.amount if coinbase_tx else 0
        base_reward = app.blockchain.get_block_reward(block.index)
        fee_reward = total_reward - base_reward

        # Calcula saldo do minerador após mineração
        miner_balance = app.blockchain.get_balance(miner_address)

        response = {
            'message': 'Novo bloco minerado!',
            'block': block.to_dict(),
            'base_reward': base_reward,
            'fee_reward': max(0, fee_reward),
            'total_reward': total_reward,
            'miner_address': miner_address,
            'miner_balance': miner_balance,
            'difficulty': app.blockchain.difficulty,
            'supply': app.blockchain.get_supply_info()
        }
        # Notifica clientes SSE sobre atualização da chain
        sse_manager.publish('chain_updated', {
            'block_index': block.index,
            'block_hash': block.hash,
            'blocks': len(app.blockchain.chain),
            'miner_address': miner_address
        })
        sse_manager.publish('mempool_updated', {
            'pending': len(app.blockchain.pending_transactions)
        })
        return jsonify(response), 200

    # ─── Mineração externa (PoW feito pelo minerador) ────────────

    @app.route('/mining/template', methods=['GET'])
    @rate_limit_mining
    def mining_template():
        """
        Entrega o bloco candidato para o minerador resolver o PoW.

        Query string:
            address: endereço que recebe a recompensa (padrão: do nó)

        O minerador recebe a altura, o hash anterior, a dificuldade e as
        transações (coinbase + mempool), procura o nonce na CPU dele e
        devolve o bloco pronto em POST /mining/submit.
        """
        miner_address = request.args.get('address') or app.node_wallet_address

        if miner_address != app.node_wallet_address:
            if not CryptoUtils.is_valid_address(miner_address):
                return jsonify({
                    'error': f'Endereço de minerador inválido: {miner_address[:30]}...',
                    'hint': 'Informe um endereço Base58 Kurama válido.'
                }), 400

        # O template só existe quando o próximo bloco já pode ser minerado,
        # senão o minerador resolveria PoW para nada.
        wait = _seconds_until_next_block()
        if wait > 0:
            return _block_cooldown_response(wait)

        template = app.blockchain.create_mining_template(miner_address)
        return jsonify(template), 200

    @app.route('/mining/submit', methods=['POST'])
    @rate_limit_mining
    def mining_submit():
        """
        Recebe o bloco já minerado por um minerador externo.

        Body (JSON): o template devolvido por /mining/template com o
        campo `proof` preenchido pelo minerador.

        Valida altura, previous_hash, dificuldade, PoW, merkle root,
        assinaturas e coinbase antes de aceitar o bloco.
        """
        data = request.get_json(silent=True)

        if not data or not isinstance(data, dict):
            return jsonify({'error': 'Bloco não fornecido'}), 400

        wait = _seconds_until_next_block()
        if wait > 0:
            return _block_cooldown_response(wait)

        try:
            block = app.blockchain.submit_mined_block(data)
        except (KeyError, TypeError, AttributeError, IndexError) as exc:
            # Corpo que nem é um bloco (campo faltando, tipo errado) não é
            # template velho: é requisição inválida, não 500.
            return jsonify({
                'error': f'Bloco malformado: {exc}',
                'hint': 'Envie o bloco completo de GET /mining/template, '
                        'com o campo proof resolvido.',
            }), 400
        except ValueError as exc:
            return jsonify({
                'error': str(exc),
                'hint': 'Peça um novo template em GET /mining/template.'
            }), 409

        coinbase = block.transactions[0] if block.transactions else None
        total_reward = coinbase.amount if coinbase else 0
        base_reward = app.blockchain.get_block_reward(block.index)
        miner_address = coinbase.receiver if coinbase else app.node_wallet_address

        sse_manager.publish('chain_updated', {
            'block_index': block.index,
            'block_hash': block.hash,
            'blocks': len(app.blockchain.chain),
            'miner_address': miner_address
        })
        sse_manager.publish('mempool_updated', {
            'pending': len(app.blockchain.pending_transactions)
        })

        return jsonify({
            'message': 'Bloco minerado aceito!',
            'block': block.to_dict(),
            'base_reward': base_reward,
            'fee_reward': max(0.0, total_reward - base_reward),
            'total_reward': total_reward,
            'miner_address': miner_address,
            'miner_balance': app.blockchain.get_balance(miner_address),
            'difficulty': app.blockchain.difficulty,
            'supply': app.blockchain.get_supply_info()
        }), 200

    @app.route('/transactions/new', methods=['POST'])
    @rate_limit
    def new_transaction():
        """
        Cria uma nova transação.

        Body (JSON):
        {
            "sender": "<chave pública do remetente>",
            "receiver": "<endereço do destinatário>",
            "amount": 10.0,
            "fee": 0.001,                     # Taxa (mín 0.001 KUR)
            "signature": "<assinatura hex>"   # Opcional
        }

        Se a transação não tem assinatura, ela é rejeitada.
        """
        data = request.get_json()

        # Valida campos obrigatórios
        required = ['sender', 'receiver', 'amount']
        if not data or not all(k in data for k in required):
            missing = [k for k in required if k not in (data or {})]
            return jsonify({
                'error': 'Campos obrigatórios ausentes',
                'required': required,
                'missing': missing
            }), 400

        try:
            # Adiciona a transação à pool de pendentes
            index = app.blockchain.add_transaction(
                sender=data['sender'],
                receiver=data['receiver'],
                amount=float(data['amount']),
                signature=data.get('signature'),
                sender_address=data.get('sender_address'),
                timestamp=data.get('timestamp'),
                fee=float(data.get('fee', 0.001))
            )

            # Notifica clientes SSE
            sse_manager.publish('mempool_updated', {
                'pending': len(app.blockchain.pending_transactions),
                'new_tx_index': index
            })

            return jsonify({
                'message': f'Transação adicionada. Será minerada no bloco #{index}',
                'transaction_index': index,
                'transaction_id': None  # Será definido pelo bloco
            }), 201

        except ValueError as e:
            # B-03: Mensagens de erro genéricas em 4xx (não expõe detalhes internos)
            return jsonify({'error': 'Requisição inválida. Verifique os dados fornecidos.'}), 400
        except Exception:
            return jsonify({'error': 'Erro interno do servidor'}), 500

    @app.route('/wallet/new', methods=['POST'])
    @rate_limit
    def new_wallet():
        """
        Gera uma nova carteira e a frase de recuperação de 24 palavras.

        A chave privada é derivada da frase (BIP39 + BIP32), então a própria
        frase recria a carteira. Trate a frase como a chave: quem a tiver
        controla os fundos.

        A frase é gerada em memória e devolvida UMA ÚNICA VEZ nesta resposta.
        Ela não é gravada em disco, banco, log ou qualquer armazenamento —
        o usuário precisa anotá-la (em papel) na hora.

        Em produção, o ideal é que a frase seja gerada no próprio cliente
        (Web Crypto), para nunca trafegar pela rede.

        SEGURANÇA (chave privada):
        - Por padrão a chave privada NÃO é devolvida, nem em desenvolvimento.
        - Para assinar localmente no frontend, ligue explicitamente
          KURAMA_DEV_EXPOSE_KEYS=true (nunca em produção).
        - A frase de recuperação continua sendo exibida uma única vez:
          sem ela a carteira não pode ser restaurada.
        """
        mnemonic = generate_mnemonic()
        wallet = Wallet(private_key_pem=private_key_pem_from_mnemonic(mnemonic))
        print(f"[KEY] NOVA CARTEIRA CRIADA: {wallet.address}")
        # NUNCA logar a frase de recuperação nem a chave privada (A-03)

        # ─── Retorna dados públicos da carteira ─────────────────
        # A chave privada NUNCA deve ser transmitida pela rede (C-01).
        # Em produção, a assinatura é feita exclusivamente no cliente.
        data = wallet.export_public()
        # Frase de recuperação: exibida uma única vez pelo frontend e nunca
        # persistida. Sem ela não há como recuperar esta carteira.
        data['mnemonic'] = mnemonic
        data['mnemonic_words'] = len(mnemonic.split())

        if _dev_keys_enabled():
            # OPT-IN EXPLÍCITO (KURAMA_DEV_EXPOSE_KEYS=true) e fora de produção.
            data['private_key_pem'] = wallet.private_key_pem
            data['warning'] = (
                'DEV MODE: chave privada exposta por opt-in explícito. '
                'Nunca use isto em produção.'
            )
        else:
            data['warning'] = (
                'Guarde sua frase de recuperação com segurança! '
                'Ela não pode ser recuperada.'
            )
        
        return jsonify(data), 200

    @app.route('/wallet/restore', methods=['POST'])
    @rate_limit
    def restore_wallet():
        """
        Recria uma carteira a partir da frase de recuperação de 24 palavras.

        A frase é usada apenas para derivar as chaves e validar o checksum
        (BIP39). Ela NÃO é armazenada nem logada — o servidor não guarda
        nada sobre ela depois de responder.

        Body JSON:
            {"mnemonic": "palavra1 palavra2 ... palavra24"}
        """
        data_in = request.get_json(silent=True) or {}
        mnemonic = ' '.join(str(data_in.get('mnemonic', '')).split()).lower()

        if not mnemonic:
            return jsonify({'error': 'Informe a frase de recuperação.'}), 400

        # Valida quantidade de palavras, wordlist e checksum antes de derivar
        if not is_valid_mnemonic(mnemonic):
            return jsonify({
                'error': 'Frase de recuperação inválida. '
                         'Confira as 24 palavras e a ordem.'
            }), 400

        try:
            wallet = Wallet(private_key_pem=private_key_pem_from_mnemonic(mnemonic))
        except Exception:
            return jsonify({'error': 'Não foi possível restaurar a carteira.'}), 400

        data = wallet.export_public()
        data['mnemonic_words'] = len(mnemonic.split())
        data['restored'] = True

        if _dev_keys_enabled():
            # Mesma política de /wallet/new: só com opt-in explícito.
            data['private_key_pem'] = wallet.private_key_pem

        return jsonify(data), 200

    @app.route('/balance/<address>', methods=['GET'])
    def get_balance(address: str):
        """
        Retorna o saldo de um endereço.

        Query params:
            history: 'true' para retornar histórico (default: false)
            limit: Número de transações no histórico (default: 20, max: 100)

        SEGURANÇA (M-03): Histórico detalhado só retorna com ?history=true
        para evitar vazamento de metad financeiros por padrão.
        """
        balance = app.blockchain.get_balance(address)
        
        # Por padrão, NÃO retorna histórico (proteção de privacidade)
        include_history = request.args.get('history', 'false').lower() == 'true'
        limit = min(request.args.get('limit', 20, type=int), 100)
        
        result = {
            'address': address,
            'balance': balance,
        }
        
        if include_history:
            transactions = app.blockchain.get_transaction_history(address)
            result['transactions_count'] = len(transactions)
            result['transactions'] = transactions[-limit:]
        
        return jsonify(result), 200

    @app.route('/nodes/register', methods=['POST'])
    @rate_limit
    @rate_limit_peer
    @_require_p2p_auth
    @require_p2p_nonce
    def register_nodes():
        """
        Registra nós vizinhos na rede.

        Body (JSON):
        {
            "nodes": ["http://localhost:5001", "http://localhost:5002"]
        }
        """
        data = _p2p_payload()

        if not data or 'nodes' not in data:
            return jsonify({
                'error': 'Forneça uma lista de "nodes" no body'
            }), 400

        nodes = data['nodes']
        if not isinstance(nodes, list):
            return jsonify({'error': '"nodes" deve ser uma lista'}), 400

        registered = []
        duplicates = []
        invalid = []

        for node_url in nodes:
            if not isinstance(node_url, str) or not node_url:
                invalid.append(str(node_url)[:120])
                continue

            if _is_node_registered(node_url):
                duplicates.append(node_url)
                continue

            if len(app.nodes) >= P2P_MAX_PEERS:
                invalid.append(
                    f'{node_url} (limite de {P2P_MAX_PEERS} peers atingido)'
                )
                continue

            # ─── Anti-SSRF ────────────────────────────────────────
            # IPs privados/loopback/link-local/ULA/CGNAT e IPv4 mapeado
            # em IPv6 são recusados; a porta precisa estar na allowlist.
            hostname, resolved_ip, error = _resolve_public_peer(node_url)
            if error:
                invalid.append(f'{node_url} ({error})')
                continue

            app.nodes[node_url] = {
                'url': node_url,
                'node_id': data.get('node_id', ''),
                'hostname': hostname,
                'resolved_ip': resolved_ip,
                'trusted': False,
                'registered_at': time.time(),
                'last_seen': time.time()
            }
            registered.append(node_url)

        return jsonify({
            'message': f'{len(registered)} nó(s) registrado(s)',
            'total_nodes': len(app.nodes),
            'registered': registered,
            'duplicates': duplicates,
            'invalid': invalid
        }), 201

    @app.route('/nodes/resolve', methods=['POST'])
    @rate_limit
    @rate_limit_peer
    @_require_p2p_auth
    @require_p2p_nonce
    def consensus():
        """
        Executa o algoritmo de consenso.
        Consulta todos os nós vizinhos e substitui a cadeia local
        pela mais longa e válida.

        SEGURANÇA:
        - Requer autenticação P2P (HMAC-SHA256)
        - Rate limited para prevenir DoS e SSRF amplification
        - Método POST (REST correto para operação com side effects)
        """
        replaced = False
        other_chains = []

        # Coleta as cadeias de todos os nós vizinhos
        for node in _get_node_urls():
            # ─── Anti-DNS Rebinding ────────────────────────────
            # Re-resolve o hostname e compara com o IP registrado.
            # Se o DNS mudou, rejeita a requisição.
            if not _validate_node_dns(node, app.nodes.get(node)):
                print(f"   [WARN] Nó {node}: DNS rebinding detectado. Ignorado.")
                continue

            try:
                response = _verified_request('GET', f'{node}/chain')
                if response.status_code == 200:
                    chain_data = response.json().get('chain', [])
                    other_chains.append(chain_data)
                    print(f"   Nó {node}: {len(chain_data)} blocos")
                    # Atualiza last_seen
                    if node in app.nodes:
                        app.nodes[node]['last_seen'] = time.time()
            except requests.exceptions.RequestException as e:
                print(f"   [WARN] Nó {node} não respondeu: {e}")

        # Executa o consenso
        replaced = app.blockchain.resolve_conflicts(other_chains)

        return jsonify({
            'message': 'Cadeia substituída' if replaced else 'Cadeia mantida',
            'chain_length': len(app.blockchain.chain),
            'nodes_consulted': len(other_chains),
            'total_nodes': len(app.nodes),
            'replaced': replaced
        }), 200

    @app.route('/validate', methods=['GET'])
    def validate():
        """
        Valida a integridade de toda a blockchain.
        Verifica hashes, ligações e transações de todos os blocos.
        """
        is_valid = app.blockchain.is_chain_valid()

        # Informações detalhadas
        issues = []
        if not is_valid:
            for i, block in enumerate(app.blockchain.chain):
                if block.hash != block.calculate_hash():
                    issues.append({
                        'block': i,
                        'issue': 'hash_mismatch',
                        'expected': block.calculate_hash(),
                        'actual': block.hash
                    })

        return jsonify({
            'valid': is_valid,
            'blocks': len(app.blockchain.chain),
            'issues': issues if issues else None
        }), 200

    @app.route('/stats', methods=['GET'])
    def stats():
        """
        Retorna estatísticas da blockchain.
        Útil para monitoramento e debug.
        """
        total_tx = sum(
            len(block.transactions) for block in app.blockchain.chain
        )
        supply = app.blockchain.get_supply_info()
        last_block = app.blockchain.last_block
        return jsonify({
            'blocks': len(app.blockchain.chain),
            'total_transactions': total_tx,
            'pending_transactions': len(app.blockchain.pending_transactions),
            'difficulty': app.blockchain.difficulty,
            'reward': app.blockchain.reward,
            'node_id': app.blockchain.node_id,
            'miner_address': app.node_wallet_address,
            'peer_nodes': _get_node_urls(),
            'genesis_hash': app.blockchain.chain[0].hash if app.blockchain.chain else None,
            'last_block_hash': last_block.hash if last_block else None,
            # Ritmo de blocos (alvo do Bitcoin): o explorer conta até o próximo.
            'last_block_timestamp': last_block.timestamp if last_block else None,
            'target_block_time': TARGET_BLOCK_TIME,
            'next_block_at': (last_block.timestamp + TARGET_BLOCK_TIME) if last_block else None,
            'chain_valid': app.blockchain.is_chain_valid(),
            'total_supply': supply['total_supply'],
            'supply_cap': supply['supply_cap'],
            'remaining_supply': supply['remaining_supply'],
            'percent_mined': supply['percent_mined'],
            'token_name': supply['token_name'],
            'token_symbol': supply['token_symbol']
        }), 200

    @app.route('/api/supply', methods=['GET'])
    def supply():
        """
        Retorna informações detalhadas sobre o supply do token.
        Inclui: total minerado, supply cap, restante, percentual.
        """
        from config import TOTAL_SUPPLY_CAP, INITIAL_BLOCK_REWARD, HALVING_INTERVAL
        info = app.blockchain.get_supply_info()
        info['initial_reward'] = INITIAL_BLOCK_REWARD
        info['halving_interval'] = HALVING_INTERVAL
        current_reward = app.blockchain.get_block_reward(
            len(app.blockchain.chain)
        )
        info['current_block_reward'] = current_reward
        return jsonify(info), 200

    @app.route('/transactions/pending', methods=['GET'])
    def pending_transactions():
        """Retorna as transações pendentes (mempool)."""
        return jsonify({
            'count': len(app.blockchain.pending_transactions),
            'transactions': [
                tx.to_dict() for tx in app.blockchain.pending_transactions
            ]
        }), 200

    # ─── Endpoints de Rede (P2P) ───────────────────────────────────

    @app.route('/blocks/new', methods=['POST'])
    @rate_limit
    @rate_limit_peer
    @_require_p2p_auth
    @require_p2p_nonce
    def receive_block():
        """
        Recebe um bloco minerado por outro nó.

        Validações:
        1. Autenticação P2P (X-Kurama-Auth + HMAC)
        2. Nonce anti-replay (X-Kurama-Nonce)
        3. Assinatura ECDSA do payload (obrigatória)
        4. Consenso completo via Blockchain.submit_mined_block

        Body (JSON): bloco em formato dict (Block.to_dict())
        """
        data = _p2p_payload()

        if not data:
            return jsonify({'error': 'Dados do bloco não fornecidos'}), 400
        if not isinstance(data, dict):
            return jsonify({'error': 'Dados do bloco inválidos'}), 400

        # ─── Verificação de Assinatura ECDSA P2P (OBRIGATÓRIA) ─
        # P2P_REQUIRE_SIGNATURE=True: toda mensagem P2P DEVE ser assinada.
        # A assinatura prova que o remetente é dono da chave privada
        # correspondente à chave pública fornecida (não-repúdio).
        from config import P2P_REQUIRE_SIGNATURE as _SIG_REQUIRED
        p2p_sig = request.headers.get(P2P_SIGNATURE_HEADER)
        p2p_pubkey = _decode_p2p_public_key(
            request.headers.get(P2P_PUBKEY_HEADER)
        )

        if _SIG_REQUIRED and (not p2p_sig or not p2p_pubkey):
            return jsonify({
                'error': 'Assinatura ECDSA P2P obrigatória. '
                         'Forneça X-Kurama-Signature e X-Kurama-Public-Key.'
            }), 401

        if p2p_sig and p2p_pubkey:
            if not CryptoUtils.verify_p2p_signature(data, p2p_sig, p2p_pubkey):
                peer_score_manager.record_event(
                    p2p_pubkey[:32], 'invalid_signature'
                )
                return jsonify({
                    'error': 'Assinatura ECDSA P2P inválida.'
                }), 401
            peer_score_manager.record_event(
                p2p_pubkey[:32], 'valid_block'
            )

        try:
            # O nó pode enviar {'block': {...}} ou o dict diretamente
            block_data = data.get('block', data)
            from core.block import Block
            try:
                candidate = Block.from_dict(block_data, Transaction)
            except (ValueError, KeyError, TypeError):
                return jsonify({'error': 'Bloco inválido'}), 400

            # Idempotência: o mesmo bloco já aceito responde 200.
            if candidate.index < len(app.blockchain.chain):
                existing = app.blockchain.chain[candidate.index]
                if existing.hash == candidate.hash:
                    return jsonify({
                        'message': 'Bloco já existe', 'status': 'duplicate'
                    }), 200

            # Reaproveita TODAS as regras do consenso (altura,
            # previous_hash, dificuldade, timestamp, hash/PoW, merkle,
            # transações, coinbase, supply e mempool) sob o lock de
            # mineração. É a mesma validação de submit_mined_block.
            block = app.blockchain.submit_mined_block(block_data)

            return jsonify({
                'message': 'Bloco recebido e adicionado à cadeia local',
                'block_index': block.index,
                'block_hash': block.hash,
                'chain_length': len(app.blockchain.chain)
            }), 201

        except ValueError as e:
            return jsonify({'error': f'Bloco inválido: {e}'}), 400
        except Exception:
            return jsonify({'error': 'Erro interno do servidor'}), 500

    # ═══════════════════════════════════════════════════════════════
    # ENDPOINTS DO EXPLORER (/api/*)
    # ═══════════════════════════════════════════════════════════════

    @app.route('/api/health', methods=['GET'])
    def api_health():
        """Health check para nós e frontend."""
        return jsonify({
            'status': 'ok',
            'node_id': app.blockchain.node_id,
            'blocks': len(app.blockchain.chain),
            'peer_count': len(app.nodes)
        }), 200

    @app.route('/api/chain/since/<int:index>', methods=['GET'])
    def api_chain_since(index: int):
        """
        Retorna blocos a partir do índice especificado.
        Útil para sincronização incremental do frontend.
        """
        blocks = []
        for block in app.blockchain.chain:
            if block.index > index:
                blocks.append(block.to_dict())
        return jsonify({
            'blocks': blocks,
            'count': len(blocks),
            'tip': len(app.blockchain.chain) - 1
        }), 200

    @app.route('/api/blocks/<identifier>', methods=['GET'])
    def api_block_by_id(identifier: str):
        """
        Retorna um bloco por índice numérico ou hash hexadecimal.
        Detecta automaticamente se é index ou hash.
        """
        # Tenta como índice numérico
        if identifier.isdigit():
            idx = int(identifier)
            if 0 <= idx < len(app.blockchain.chain):
                block = app.blockchain.chain[idx]
                return jsonify(block.to_dict()), 200
            return jsonify({'error': 'Bloco não encontrado', 'identifier': identifier}), 404

        # Tenta como hash (64 caracteres hex)
        if len(identifier) == 64:
            for block in app.blockchain.chain:
                if block.hash == identifier:
                    return jsonify(block.to_dict()), 200
            return jsonify({'error': 'Hash não encontrado', 'identifier': identifier}), 404

        return jsonify({'error': 'Identificador inválido. Use um número de índice ou hash de 64 caracteres.'}), 400

    @app.route('/api/transactions', methods=['GET'])
    def api_transactions():
        """
        Retorna todas as transações com paginação e filtros.

        Query params:
            page: Número da página (default: 1)
            per_page: Itens por página (default: 20)
            address: Filtrar por endereço (remetente OU destinatário)
            sender: Filtrar só por remetente
            receiver: Filtrar só por destinatário
            min_amount: Valor mínimo
            max_amount: Valor máximo
        """
        # Validação de parâmetros de paginação
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 20, type=int)
        
        # Valida page (deve ser positivo)
        if page < 1:
            return jsonify({'error': 'page deve ser um número positivo'}), 400
        
        # Valida per_page (deve ser positivo e menor que MAX_PER_PAGE)
        MAX_PER_PAGE = 100
        if per_page < 1:
            return jsonify({'error': 'per_page deve ser um número positivo'}), 400
        if per_page > MAX_PER_PAGE:
            per_page = MAX_PER_PAGE  # Limita para evitar OOM

        address = request.args.get('address', None, type=str)
        sender = request.args.get('sender', None, type=str)
        receiver = request.args.get('receiver', None, type=str)
        min_amount = request.args.get('min_amount', None, type=float)
        max_amount = request.args.get('max_amount', None, type=float)

        # Ledger de depósitos nativo → EVM (transaction_id → hash EVM).
        try:
            from evm.deposits import get_deposit_hash, load_ledger
            deposit_ledger = load_ledger()
        except Exception:
            deposit_ledger = {}

        # Coleciona todas as transações com info do bloco
        all_txs = []
        for block in app.blockchain.chain:
            for tx in block.transactions:
                tx_dict = tx.to_dict() if hasattr(tx, 'to_dict') else tx
                tx_dict['block_index'] = block.index
                tx_dict['confirmed'] = True
                evm_hash = get_deposit_hash(
                    tx_dict.get('transaction_id'), deposit_ledger)
                if evm_hash:
                    tx_dict['evm_tx_hash'] = evm_hash
                all_txs.append(tx_dict)

        # Aplica filtros
        if address:
            all_txs = [
                tx for tx in all_txs
                if tx.get('sender') == address
                or tx.get('receiver') == address
                or tx.get('sender_address') == address
            ]
        # `sender`/`receiver` são usados pelo frontend; sem eles a lista de
        # enviadas e recebidas traz tudo e cada tx aparece duplicada na UI.
        if sender:
            all_txs = [
                tx for tx in all_txs
                if tx.get('sender') == sender or tx.get('sender_address') == sender
            ]
        if receiver:
            all_txs = [tx for tx in all_txs if tx.get('receiver') == receiver]
        if min_amount is not None:
            all_txs = [tx for tx in all_txs if tx.get('amount', 0) >= min_amount]
        if max_amount is not None:
            all_txs = [tx for tx in all_txs if tx.get('amount', 0) <= max_amount]

        # Paginação
        total = len(all_txs)
        total_pages = max(1, (total + per_page - 1) // per_page)
        start = (page - 1) * per_page
        end = start + per_page
        page_txs = all_txs[start:end]

        return jsonify({
            'transactions': page_txs,
            'page': page,
            'per_page': per_page,
            'total': total,
            'total_pages': total_pages
        }), 200

    @app.route('/api/search', methods=['GET'])
    def api_search():
        """
        Busca unificada.
        Detecta se o termo é índice, hash ou endereço.

        Query params:
            q: Termo de busca
        """
        query = request.args.get('q', '').strip()

        if not query:
            return jsonify({'error': 'Forneça um termo de busca em ?q='}), 400

        # Tenta como índice de bloco
        if query.isdigit():
            idx = int(query)
            if 0 <= idx < len(app.blockchain.chain):
                return jsonify({
                    'type': 'block',
                    'data': app.blockchain.chain[idx].to_dict(),
                    'url': f'/explorer/{idx}'
                }), 200

        # Tenta como hash de bloco (64 hex chars)
        if len(query) == 64:
            for block in app.blockchain.chain:
                if block.hash == query:
                    return jsonify({
                        'type': 'block',
                        'data': block.to_dict(),
                        'url': f'/explorer/{block.index}'
                    }), 200

        # Tenta como endereço de carteira
        balance = app.blockchain.get_balance(query)
        if len(query) > 20:  # Endereços Base58 têm mais de 20 chars
            return jsonify({
                'type': 'address',
                'data': {
                    'address': query,
                    'balance': balance
                },
                'url': f'/wallet/{query}'
            }), 200

        return jsonify({'error': 'Nenhum resultado encontrado', 'query': query}), 404

    @app.route('/api/nodes', methods=['GET'])
    def api_nodes():
        """
        Lista todos os nós registrados com status de saúde.
        Pinga cada nó e retorna latência e status.
        """
        from config import NODE_HEALTH_TIMEOUT

        nodes_list = []

        # Adiciona o próprio nó
        nodes_list.append({
            'url': f'http://localhost:{port}',
            'active': True,
            'blocks': len(app.blockchain.chain),
            'node_id': app.blockchain.node_id,
            'latency_ms': 0,
            'is_self': True
        })

        # Verifica saúde dos nós vizinhos
        for node_url in _get_node_urls():
            # Anti-DNS rebinding
            if not _validate_node_dns(node_url, app.nodes.get(node_url)):
                continue
            try:
                start = time.time()
                resp = _verified_request('GET', f'{node_url}/api/health',
                                         timeout=NODE_HEALTH_TIMEOUT)
                latency = int((time.time() - start) * 1000)
                if resp.status_code == 200:
                    data = resp.json()
                    nodes_list.append({
                        'url': node_url,
                        'active': True,
                        'blocks': data.get('blocks', 0),
                        'node_id': data.get('node_id', 'unknown'),
                        'latency_ms': latency,
                        'is_self': False
                    })
                else:
                    nodes_list.append({
                        'url': node_url,
                        'active': False,
                        'blocks': 0,
                        'node_id': 'unknown',
                        'latency_ms': None,
                        'is_self': False
                    })
            except requests.exceptions.RequestException:
                nodes_list.append({
                    'url': node_url,
                    'active': False,
                    'blocks': 0,
                    'node_id': 'unknown',
                    'latency_ms': None,
                    'is_self': False
                })

        return jsonify({
            'nodes': nodes_list,
            'total': len(nodes_list),
            'active': sum(1 for n in nodes_list if n['active'])
        }), 200

    # ─── Peer Discovery Endpoint ───────────────────────────────────
    # Retorna lista de peers conhecidos para bootstrap na rede.
    @app.route('/api/peers', methods=['GET'])
    @rate_limit
    def api_peers():
        """Retorna lista de peers conhecidos (para descoberta de rede)."""
        from config import SEED_NODES
        peers = []
        for url in _get_node_urls():
            node_info = app.nodes.get(url, {})
            peers.append({
                'url': url,
                'node_id': node_info.get('node_id', ''),
                'hostname': node_info.get('hostname', ''),
                'registered_at': node_info.get('registered_at', 0),
                'last_seen': node_info.get('last_seen', 0)
            })
        return jsonify({
            'peers': peers,
            'total': len(peers),
            'seed_nodes': SEED_NODES
        }), 200

    @app.route('/api/nodes/sync', methods=['POST'])
    @rate_limit
    @rate_limit_peer
    @_require_p2p_auth
    @require_p2p_nonce
    def api_nodes_sync():
        """
        Executa consenso contra todos os nós vizinhos.
        Substitui a cadeia local pela mais longa e válida.

        SEGURANÇA:
        - Requer autenticação P2P (HMAC-SHA256)
        - Rate limited para prevenir SSRF amplification
        """
        other_chains = []
        results = []

        for node_url in _get_node_urls():
            # Anti-DNS rebinding
            if not _validate_node_dns(node_url, app.nodes.get(node_url)):
                results.append({
                    'node': node_url,
                    'blocks': 0,
                    'status': 'dns_rebinding_detected'
                })
                continue
            try:
                resp = _verified_request('GET', f'{node_url}/chain')
                if resp.status_code == 200:
                    chain_data = resp.json().get('chain', [])
                    other_chains.append(chain_data)
                    results.append({
                        'node': node_url,
                        'blocks': len(chain_data),
                        'status': 'ok'
                    })
                else:
                    results.append({
                        'node': node_url,
                        'blocks': 0,
                        'status': 'error'
                    })
            except requests.exceptions.RequestException as e:
                results.append({
                    'node': node_url,
                    'blocks': 0,
                    'status': f'failed: {str(e)[:50]}'
                })

        replaced = app.blockchain.resolve_conflicts(other_chains)

        return jsonify({
            'message': 'Cadeia substituída' if replaced else 'Cadeia mantida',
            'chain_length': len(app.blockchain.chain),
            'nodes_consulted': len(other_chains),
            'replaced': replaced,
            'results': results
        }), 200

    @app.route('/api/chart', methods=['GET'])
    def api_chart():
        """
        Retorna dados formatados para o gráfico do Dashboard.
        Inclui blocos recentes com contagem de transações,
        transações acumuladas e dificuldade.

        Query params:
            limit: Número de blocos a retornar (default: 50)
        """
        limit = request.args.get('limit', 50, type=int)
        limit = min(limit, 200)  # Máximo 200 blocos

        chain = app.blockchain.chain
        start = max(0, len(chain) - limit)
        chart_data = []
        cum_tx = 0

        for block in chain[start:]:
            tx_count = len(block.transactions)
            cum_tx += tx_count
            chart_data.append({
                'block': block.index,
                'timestamp': block.timestamp,
                'transactions': tx_count,
                'cumulativeTx': cum_tx,
                'difficulty': block.difficulty or 0,
            })

        return jsonify(chart_data), 200

    @app.route('/api/mempool', methods=['GET'])
    def api_mempool():
        """
        Retorna estatísticas detalhadas da mempool.
        """
        stats = app.blockchain.get_mempool_stats()
        return jsonify({
            **stats,
            'transactions': [
                tx.to_dict() for tx in app.blockchain.pending_transactions
            ]
        }), 200

    # ═══════════════════════════════════════════════════════════════
    # SERVER-SENT EVENTS (tempo real sem polling)
    # ═══════════════════════════════════════════════════════════════
    # Usa SSE em vez de WebSocket para simplificar: nao requer
    # bibliotecas extras, funciona com HTTP padrao, auto-reconnect
    # nativo no navegador via EventSource API.

    # ─── SSE Connection Limit (Anti-DoS) ──────────────────────
    # Limita conexões SSE simultâneas para prevenir exaustão
    # de threads/memória (A-02 parcial).
    SSE_MAX_CONNECTIONS = 50

    @app.route('/api/events', methods=['GET'])
    @rate_limit
    def api_events():
        """
        Server-Sent Events (SSE) para atualizações em tempo real.

        O frontend se conecta a este endpoint via EventSource.
        Eventos:
        - **chain_updated**: blockchain mudou (novo bloco minerado)
        - **mempool_updated**: transação adicionada/removida da mempool
        - **ping**: keepalive a cada 30s

        Uso (frontend):
            const source = new EventSource('/api/events');
            source.addEventListener('chain_updated', (e) => {
                const data = JSON.parse(e.data);
                refreshChain();
            });
        """
        # Verifica limite de conexões SSE
        if sse_manager.subscriber_count >= SSE_MAX_CONNECTIONS:
            response = jsonify({
                'error': 'Limite de conexões SSE atingido. Reconecte mais tarde.',
                'code': 'SSE_LIMIT_REACHED'
            })
            response.status_code = 429
            response.headers['Retry-After'] = '30'
            return response

        def event_stream():
            q = sse_manager.subscribe()
            try:
                while True:
                    try:
                        msg = q.get(timeout=30)
                        event_type = msg.get('event', 'message')
                        data = msg.get('data', {})
                        yield f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
                    except queue.Empty:
                        # Keepalive a cada 30s
                        yield f": keepalive\n\n"
            except GeneratorExit:
                pass
            finally:
                sse_manager.unsubscribe(q)

        return Response(
            stream_with_context(event_stream()),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no',
            }
        )

    # ═══════════════════════════════════════════════════════════════
    # ENDPOINTS DE AÇÃO (Frontend)
    # ═══════════════════════════════════════════════════════════════

    @app.route('/api/transactions/create-signed', methods=['POST'])
    @rate_limit
    def create_signed_transaction():
        """
        Cria uma transação ASSINADA a partir de uma chave privada.

        Este endpoint é usado pelo frontend para criar transações
        sem necessidade de bibliotecas criptográficas no navegador.
        A chave privada é enviada por HTTPS (dev) e usada apenas
        para assinar — NUNCA é armazenada no servidor.

        ATENÇÃO (Dev only):
        - Em produção, a assinatura DEVE ser feita no cliente.
        - A chave privada NUNCA deve trafegar pela rede em produção.

        Body (JSON):
        {
            "private_key_pem": "<chave privada PEM>",
            "receiver": "<endereço do destinatário>",
            "amount": 10.0,
            "fee": 0.001              # Opcional (default: 0.001)
        }

        Returns:
            Dados da transação criada ou erro
        """
        data = request.get_json()

        required = ['private_key_pem', 'receiver', 'amount']
        if not data or not all(k in data for k in required):
            missing = [k for k in required if k not in (data or {})]
            return jsonify({
                'error': 'Campos obrigatórios ausentes',
                'required': required,
                'missing': missing
            }), 400

        # ─── PROTEÇÃO: Desabilitar em produção ──────────────────
        # Em produção, a assinatura DEVE ser feita no cliente.
        # Este endpoint existe apenas para desenvolvimento/testes.
        if _is_production_mode():
            return jsonify({
                'error': 'Este endpoint está desabilitado em produção. '
                         'As transações devem ser assinadas no cliente.',
                'code': 'PROD_SIGN_DISABLED'
            }), 403
        
        try:
            # Reconstrói a wallet a partir da chave privada
            wallet = Wallet(private_key_pem=data['private_key_pem'])

            receiver = data['receiver']
            amount = float(data['amount'])
            fee = float(data.get('fee', 0.001))

            # ─── Destino EVM (0x...) ────────────────────────────
            # A EVM da KuramaChain tem estado próprio: creditar só a camada
            # nativa não aparece na Rabby/MetaMask. Para um destino 0x, o
            # mesmo valor é liberado na EVM pela reserva de demo (conta de
            # dev, financiada no gênesis) — modelo lock (nativo) / mint (EVM).
            evm_engine = getattr(app, 'evm_engine', None)
            evm_wei = 0
            if evm_engine is not None and CryptoUtils.is_valid_evm_address(receiver):
                from evm.deposits import credit_native_deposit, kur_to_wei
                evm_wei = kur_to_wei(amount)
                reserve = evm_engine.get_balance(evm_engine.dev_address)
                if reserve < evm_wei:
                    return jsonify({
                        'error': 'Reserva EVM insuficiente para creditar o destino',
                        'code': 'EVM_RESERVE_LOW',
                        'reserve_kur': reserve / 10 ** 18,
                        'requested_kur': amount,
                    }), 400

            # Cria e assina a transação
            tx = Transaction(
                sender=wallet.public_key_pem,
                receiver=receiver,
                amount=amount,
                fee=fee,
                sender_address=wallet.address
            )
            tx.sign(wallet.private_key_pem)

            # Adiciona à mempool via blockchain.add_transaction
            # Passa o transaction_id pré-gerado para que a assinatura
            # (que cobre o transaction_id) seja verificada corretamente.
            index = app.blockchain.add_transaction(
                sender=tx.sender,
                receiver=tx.receiver,
                amount=tx.amount,
                signature=tx.signature,
                sender_address=tx.sender_address,
                timestamp=tx.timestamp,
                fee=tx.fee,
                transaction_id=tx.transaction_id
            )

            # Crédito na EVM (depósito) — o recibo/débito nativo não move
            # estado EVM por si só. O ledger guarda transaction_id → hash EVM
            # para o explorer e para a reconciliação no próximo startup.
            evm_tx_hash = None
            if evm_wei:
                try:
                    evm_tx_hash = credit_native_deposit(
                        evm_engine, receiver, amount, tx.transaction_id,
                    )
                except Exception as exc:
                    # A tx nativa já entrou na mempool: não aborta, mas avisa.
                    app.logger.warning('[EVM] crédito de depósito falhou: %s', exc)

            message = f'Transação criada e assinada! Será minerada no bloco #{index}'
            if evm_tx_hash:
                message += (f' Depósito de {amount:g} KUR creditado na EVM '
                            f'(tx {evm_tx_hash[:18]}…) — visível na Rabby/MetaMask.')

            return jsonify({
                'message': message,
                'transaction': tx.to_dict(),
                'transaction_index': index,
                'sender_address': wallet.address,
                'sender_balance': app.blockchain.get_balance(wallet.address),
                'evm_tx_hash': evm_tx_hash,
                'evm_credited_wei': evm_wei,
                'evm_balance': (evm_engine.get_balance(receiver) if evm_tx_hash else None),
            }), 201

        except ValueError:
            return jsonify({'error': 'Transação inválida'}), 400
        except Exception:
            return jsonify({'error': 'Erro interno do servidor'}), 500

    # ═══════════════════════════════════════════════════════════════
    # SPA (build do frontend) no mesmo domínio da API
    # ═══════════════════════════════════════════════════════════════
    # O frontend usa baseURL '/', então precisa ser servido pela mesma
    # origem da API. As rotas registradas acima têm precedência sobre o
    # catch-all, que só atende GET de arquivo estático e fallback do SPA.
    _root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    dist_dir = os.environ.get(
        'FRONTEND_DIST', os.path.join(_root, 'frontend', 'dist')
    )
    if os.path.isdir(dist_dir):
        from flask import send_from_directory

        @app.route('/', defaults={'path': ''}, methods=['GET'])
        @app.route('/<path:path>', methods=['GET'])
        def serve_spa(path):
            """Serve o build do Vite e faz fallback de rotas do SPA.

            Só serve arquivos estáticos e faz fallback para index.html.
            """
            if path.startswith('api/'):
                return jsonify({'error': 'Endpoint não encontrado'}), 404
            safe = os.path.normpath(path).replace('\\', '/')
            if safe not in ('.', '') and not safe.startswith('..'):
                candidate = os.path.join(dist_dir, safe)
                if os.path.isfile(candidate):
                    return send_from_directory(dist_dir, safe)
            return send_from_directory(dist_dir, 'index.html')

        # before_request para interceptar métodos não permitidos antes do catch-all
        # Isso garante que GET /mine retorne 405 em vez de 200 com HTML do SPA.
        from flask import request as _request
        @app.before_request
        def check_method_not_allowed():
            # Verifica se a rota existe como endpoint da API com métodos diferentes
            # do catch-all (serve_spa). Se sim e o método atual não é suportado,
            # retorna 405 Method Not Allowed.
            if _request.endpoint == 'serve_spa' or _request.endpoint is None:
                path = _request.path
                if path and not path.startswith('/api/'):
                    # Verifica se existe uma regra para este path
                    rule = None
                    for r in app.url_map.iter_rules():
                        if r.rule == path or r.rule == path.rstrip('/'):
                            rule = r
                            break
                    if rule and rule.endpoint != 'serve_spa':
                        # Se o método não é suportado pela regra, retorna 405
                        if _request.method not in rule.methods and _request.method != 'HEAD':
                            return jsonify({'error': 'Método não permitido para este endpoint'}), 405

    return app
