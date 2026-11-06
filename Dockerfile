
# KuramaChain - Frontend Vite + Backend Flask

# Stage 1: Frontend
FROM node:20-alpine AS frontend

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# Stage 2: Python runtime
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=10000

WORKDIR /app

# Instalar dependências Python
COPY requirements.txt ./

RUN python -m pip install --no-cache-dir -r requirements.txt \
    && python -m pip show gunicorn

# Copiar aplicação
COPY . .

# Copiar frontend compilado
COPY --from=frontend /app/frontend/dist ./frontend/dist

EXPOSE 10000

# Inicializar API
CMD ["python", "-m", "gunicorn", "wsgi:app", "--bind", "0.0.0.0:10000", "--workers", "1", "--threads", "32", "--timeout", "120", "--access-logfile", "-"]

