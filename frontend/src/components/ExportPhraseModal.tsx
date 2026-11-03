import { useState } from 'react';
import RecoveryPhraseModal from './RecoveryPhraseModal';
import { hasSeedBackup, loadSeedBackup } from '../utils/seedVault';

interface Props {
  /** Endereço da carteira conectada. */
  address: string;
  onClose: () => void;
}

/**
 * Exporta a frase de recuperação de uma carteira existente.
 *
 * Só funciona se o usuário guardou a cópia cifrada com senha no momento da
 * criação — a frase não pode ser reconstruída a partir da chave privada.
 */
export default function ExportPhraseModal({ address, onClose }: Props) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [phrase, setPhrase] = useState<string | null>(null);

  const hasBackup = hasSeedBackup(address);

  const handleReveal = async () => {
    if (!password || loading) return;
    setLoading(true);
    setError('');
    try {
      const recovered = await loadSeedBackup(address, password);
      setPassword(''); // senha nunca fica guardada
      setPhrase(recovered);
    } catch (err: any) {
      setError(err?.message || 'Não foi possível abrir a cópia guardada.');
    } finally {
      setLoading(false);
    }
  };

  // Revelada a frase, reaproveita o aviso de exibição única (apaga ao fechar)
  if (phrase) {
    return (
      <RecoveryPhraseModal
        mnemonic={phrase}
        address={address}
        onClose={() => { setPhrase(null); onClose(); }}
      />
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-phrase-title"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <div className="bg-kur-bg-card/95 backdrop-blur-xl border border-kur-border rounded-2xl w-full max-w-md shadow-2xl shadow-glow-sm">
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-kur-border">
          <h2 id="export-phrase-title" className="text-lg font-bold text-kur-text">
            🔑 Exportar frase de recuperação
          </h2>
          <button
            onClick={onClose}
            aria-label="Fechar exportação da frase"
            className="p-1.5 rounded-lg text-kur-text-muted hover:text-kur-text hover:bg-kur-bg-hover transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-3">
          <p className="text-xs font-mono text-kur-text-muted break-all">{address}</p>

          {hasBackup ? (
            <>
              <p className="text-xs text-kur-text-muted leading-relaxed">
                Esta carteira tem uma cópia cifrada da frase. Informe a senha que você
                usou ao criar a carteira para ver as 24 palavras.
              </p>
              <div>
                <label className="block text-xs text-kur-text-muted mb-1.5 font-medium">
                  Senha da cópia cifrada
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(''); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleReveal(); }}
                  autoComplete="current-password"
                  placeholder="Sua senha"
                  className="w-full bg-kur-bg border border-kur-border rounded-lg px-3 py-2.5 text-sm text-kur-text placeholder-kur-text-muted focus:outline-none focus:border-kur-accent"
                />
              </div>

              {error && (
                <div className="bg-kur-red/5 border border-kur-red/20 rounded-lg p-3">
                  <p className="text-xs text-kur-red">❌ {error}</p>
                </div>
              )}

              <button
                onClick={handleReveal}
                disabled={!password || loading}
                className="w-full px-4 py-2.5 bg-kur-gradient text-white rounded-xl hover:brightness-110 transition-all text-sm font-semibold shadow-glow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Abrindo...' : 'Mostrar frase'}
              </button>
            </>
          ) : (
            <>
              <div className="bg-kur-yellow/10 border border-kur-yellow/30 rounded-xl p-4 space-y-2">
                <p className="text-sm font-semibold text-kur-yellow">
                  Esta carteira não tem frase guardada
                </p>
                <p className="text-xs text-kur-text-muted leading-relaxed">
                  A frase de recuperação não pode ser reconstruída a partir da chave privada,
                  e ela não foi gravada em lugar nenhum quando a carteira foi criada.
                  Sem a cópia cifrada, não há como mostrá-la de novo.
                </p>
              </div>
              <p className="text-xs text-kur-text-muted leading-relaxed">
                Para poder exportar no futuro, crie uma nova carteira e marque a opção
                "guardar uma cópia cifrada" com uma senha.
              </p>
              <button
                onClick={onClose}
                className="w-full px-4 py-2.5 bg-kur-accent/10 text-kur-accent border border-kur-accent/30 rounded-xl hover:bg-kur-accent/20 transition-all text-sm font-medium"
              >
                Entendi
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
