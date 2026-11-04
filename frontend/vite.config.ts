import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `/wallet` e `/transactions` existem nos dois lados: são rotas do SPA e
// prefixos da API do nó. O navegador pede a página (Accept: text/html) e o
// axios pede dados (Accept: application/json...). Sem separar os dois, abrir
// ou recarregar essas rotas caía no proxy e voltava 404 do nó.
// Alvo do backend. Padrão: HTTPS de dev (`python run.py`). Para rodar os
// testes e2e contra `python start_dev.py` (HTTP), defina VITE_API_TARGET.
const API_TARGET = process.env.VITE_API_TARGET || 'https://localhost:5000'

const spaFallback = (req: { headers: Record<string, string | string[] | undefined> }) => {
  const accept = req.headers.accept
  return typeof accept === 'string' && accept.includes('text/html')
    ? '/index.html'
    : undefined
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // ⚠️ Dev only: `secure: false` permite certificados auto-assinados.
      // Em produção, configure HTTPS real com CA confiável no servidor
      // backend e remova `secure: false` (ou aponte para o certificado CA).
      '/api': { target: API_TARGET, secure: false },
      '/chain': { target: API_TARGET, secure: false },
      '/mine': { target: API_TARGET, secure: false },
      '/transactions': { target: API_TARGET, secure: false, bypass: spaFallback },
      '/wallet': { target: API_TARGET, secure: false, bypass: spaFallback },
      '/balance': { target: API_TARGET, secure: false },
      '/nodes': { target: API_TARGET, secure: false },
      '/validate': { target: API_TARGET, secure: false },
      '/stats': { target: API_TARGET, secure: false },
      '/rpc': { target: API_TARGET, secure: false },
      '/api/transactions/create-signed': { target: API_TARGET, secure: false },
    },
  },
})
