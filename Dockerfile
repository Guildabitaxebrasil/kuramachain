# ─────────────────────────────────────────────────────────────────
# KuramaChain — imagem única (API Flask + SPA buildado)
#
# O frontend fala com a API pela mesma origem (baseURL '/'), então o
# build do Vite é servido pelo próprio Flask (api/routes.py -> serve_spa).
# ─────────────────────────────────────────────────────────────────

# ── Stage 1: build do frontend (Vite/React) ──────────────────────
FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: runtime Python ──────────────────────────────────────
FROM python:3.11-slim

# Dependências de sistema para compilar pacotes Python (argon2-cffi, cryptography, pycryptodome, ecdsa)
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc python3-dev libffi-dev libssl-dev && \
    rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=10000

WORKDIR /app

# Dependências primeiro (cache de camada)
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
COPY --from=frontend /app/frontend/dist ./frontend/dist

# 1 worker: a cadeia, a mempool e os assinantes SSE vivem na memória do
# processo. Threads para atender SSE + requisições normais.
CMD gunicorn wsgi:app --bind 0.0.0.0:$PORT --workers 1 --threads 32 --timeout 120 --access-logfile -

EXPOSE 10000
