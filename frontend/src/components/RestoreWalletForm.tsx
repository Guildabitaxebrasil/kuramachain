import { useState } from 'react';
import { useWallet } from '../context/WalletContext';

interface Props {
  /** Chamado após restaurar com sucesso, com o endereço recuperado. */
  onRestored?: (address: string) => void;
  /** Chamado ao desistir (voltar / fechar). */
  onCancel?: () => void;
}

const WORD_COUNT = 24;

/**
 * Restauração de carteira pela frase de recuperação (24 palavras).
 *
 * A frase digitada fica apenas no estado deste componente: não vai para
 * localStorage, cookie, arquivo nem log, e é apagada assim que a carteira
 * é restaurada.
 */
export default function RestoreWalletForm({ onRestored, onCancel }: Props) {
  const { restoreAndConnect } = useWallet();
  const [phrase, setPhrase] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const words = phrase.trim() ? phrase.trim().split(/\s+/) : [];
  const ready = words.length === WORD_COUNT;

  const handleRestore = async () => {
    if (!ready || loading) return;
    setLoading(true);
    setError('');
    try {
      const address = await restoreAndConnect(words.join(' ').toLowerCase());
      setPhrase(''); // descarta a frase da memória
      onRestored?.(address);
    } catch (err: any) {
      setError(err.message || 'Erro ao restaurar carteira');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs text-kur-text-muted mb-1.5 font-medium">
          Frase de recuperação ({WORD_COUNT} palavras)
        </label>
        <textarea
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          rows={4}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="none"
          placeholder="Digite as 24 palavras separadas por espaço..."
          className="w-full bg-kur-bg border border-kur-border rounded-lg px-3 py-2.5 text-sm font-mono text-kur-text placeholder-kur-text-muted focus:outline-none focus:border-kur-accent resize-y"
        />
        <div className="flex items-center justify-between mt-1">
          <span className="text-xs text-kur-text-muted">
            {words.length}/{WORD_COUNT} palavras
          </span>
          {words.length > 0 && !ready && (
            <span className="text-xs text-kur-yellow">Faltam {WORD_COUNT - words.length}</span>
          )}
        </div>
      </div>

      <p className="text-xs text-kur-text-muted leading-relaxed">
        🔒 A frase é usada só para recriar as chaves: não fica salva neste navegador
        nem no servidor, e é apagada desta tela ao concluir. Depois de restaurar,
        a chave privada fica no cofre do nó (nunca neste navegador) e é ele quem
        assina os envios desta carteira — aqui fica só o endereço.
      </p>

      {error && (
        <div className="bg-kur-red/5 border border-kur-red/20 rounded-lg p-3">
          <p className="text-xs text-kur-red">❌ {error}</p>
        </div>
      )}

      <button
        onClick={handleRestore}
        disabled={!ready || loading}
        className="w-full px-4 py-2.5 bg-kur-gradient text-white rounded-xl hover:brightness-110 transition-all text-sm font-semibold shadow-glow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Restaurando...
          </>
        ) : (
          'Restaurar carteira'
        )}
      </button>

      {onCancel && (
        <button
          onClick={onCancel}
          className="w-full text-xs text-kur-text-muted hover:text-kur-text transition-colors"
        >
          Voltar
        </button>
      )}
    </div>
  );
}
