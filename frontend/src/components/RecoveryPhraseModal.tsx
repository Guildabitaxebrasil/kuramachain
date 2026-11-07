import { useState } from 'react';
import { createPortal } from 'react-dom';
import { saveSeedBackup } from '../utils/seedVault';

interface Props {
  /** Frase de recuperação (24 palavras). Só existe em memória, nunca é persistida. */
  mnemonic: string;
  /** Endereço da carteira criada (informativo). */
  address?: string;
  /** Fecha o aviso; o pai deve descartar a frase do estado. */
  onClose: () => void;
}

const WARNINGS = [
  'Anote as 24 palavras no papel, na ordem exata em que aparecem.',
  'Não tire print nem foto da tela, e não salve em nuvem, WhatsApp ou e-mail.',
  'Não deixe a frase em arquivo, bloco de notas ou qualquer outro lugar no computador.',
  'Não compartilhe com ninguém: quem tiver essas palavras pode gastar tudo da carteira.',
];

/**
 * Aviso de frase de recuperação: aparece uma única vez, logo após criar a
 * carteira. Ao fechar, a frase é descartada da memória — não vai para
 * localStorage, IndexedDB, cookie, console, nem qualquer outro lugar.
 */
export default function RecoveryPhraseModal({ mnemonic, address, onClose }: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const [password, setPassword] = useState('');
  const [backupState, setBackupState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [backupError, setBackupError] = useState('');
  const words = mnemonic.split(/\s+/).filter(Boolean);

  const handleSaveBackup = async () => {
    if (!address) return;
    if (password.length < 8) {
      setBackupError('Use uma senha com pelo menos 8 caracteres.');
      return;
    }
    setBackupState('saving');
    setBackupError('');
    try {
      await saveSeedBackup(address, mnemonic, password);
      setPassword(''); // a senha nunca fica guardada
      setBackupState('saved');
    } catch (err: any) {
      setBackupError(err?.message || 'Não foi possível guardar a frase.');
      setBackupState('idle');
    }
  };

  // Portal no <body>: o modal é aberto a partir do header (que tem
  // backdrop-blur + z-index) e de páginas com animação de transform.
  // Esses dois contextos confinam `position: fixed`, então sem o portal o
  // overlay ficava espremido dentro do elemento pai e atrás da imagem.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="recovery-phrase-title"
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <div className="bg-kur-bg-card/95 backdrop-blur-xl border border-kur-yellow/40 rounded-2xl w-full max-w-2xl shadow-2xl shadow-glow-sm my-auto max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-5 sm:px-6 py-4 border-b border-kur-border">
          <div>
            <h2 id="recovery-phrase-title" className="text-lg font-bold text-kur-text">
              🔑 Sua frase de recuperação
            </h2>
            <p className="text-xs text-kur-text-muted mt-0.5">
              {words.length} palavras — a única forma de recuperar esta carteira
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar aviso da frase de recuperação"
            className="p-1.5 rounded-lg text-kur-text-muted hover:text-kur-text hover:bg-kur-bg-hover transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 sm:px-6 py-5 space-y-4 overflow-y-auto">
          {/* Avisos */}
          <div className="bg-kur-yellow/10 border border-kur-yellow/30 rounded-xl p-4">
            <p className="text-sm font-semibold text-kur-yellow mb-2">
              ⚠ Anote agora. Esta frase não fica salva em lugar nenhum.
            </p>
            <ul className="space-y-1.5">
              {WARNINGS.map((warning) => (
                <li key={warning} className="flex gap-2 text-xs text-kur-text-muted leading-relaxed">
                  <span className="text-kur-yellow shrink-0">•</span>
                  <span>{warning}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Palavras */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {words.map((word, i) => (
              <div
                key={`${i}-${word}`}
                className="flex items-center gap-2 bg-kur-bg border border-kur-border rounded-lg px-2.5 py-2"
              >
                <span className="text-[11px] text-kur-text-muted tabular-nums w-4 text-right shrink-0">
                  {i + 1}
                </span>
                <span className="font-mono text-sm text-kur-text truncate">{word}</span>
              </div>
            ))}
          </div>

          {address && (
            <div className="bg-kur-bg/60 border border-kur-border rounded-xl px-3 py-2">
              <p className="text-[11px] text-kur-text-muted uppercase tracking-wider mb-0.5">Endereço</p>
              <p className="text-xs font-mono text-kur-accent break-all">{address}</p>
            </div>
          )}

          {address && (
            <div className="bg-kur-accent/5 border border-kur-accent/20 rounded-xl p-4 space-y-2">
              <p className="text-sm font-medium text-kur-text">
                Opcional: guardar uma cópia cifrada neste navegador
              </p>
              <p className="text-xs text-kur-text-muted leading-relaxed">
                Com uma senha, você pode ver esta frase de novo depois
                (menu Conectar → Exportar frase). Ela fica cifrada com AES-256-GCM:
                sem a senha, ninguém lê as palavras.
              </p>

              {backupState === 'saved' ? (
                <p className="text-xs text-kur-green">
                  ✔ Cópia cifrada guardada. Você já pode fechar esta janela.
                </p>
              ) : (
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setBackupError(''); }}
                    placeholder="Senha (mínimo 8 caracteres)"
                    autoComplete="new-password"
                    className="flex-1 bg-kur-bg border border-kur-border rounded-lg px-3 py-2 text-sm text-kur-text placeholder-kur-text-muted focus:outline-none focus:border-kur-accent"
                  />
                  <button
                    onClick={handleSaveBackup}
                    disabled={!password || backupState === 'saving'}
                    className="btn-outline whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {backupState === 'saving' ? 'Cifrando...' : 'Guardar cifrada'}
                  </button>
                </div>
              )}

              {backupError && <p className="text-xs text-kur-red">{backupError}</p>}
            </div>
          )}

          <p className="text-xs text-kur-text-muted">
            Ao fechar esta janela as palavras desaparecem da tela. Sem a cópia cifrada,
            elas não ficam gravadas no seu computador nem no servidor e não há como
            recuperar o acesso à carteira.
          </p>

          {/* Confirmação */}
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 rounded border-kur-border bg-kur-bg text-kur-accent focus:ring-kur-accent/30"
            />
            <span className="text-xs text-kur-text">
              Anotei as 24 palavras no papel, na ordem correta.
            </span>
          </label>

          <button
            onClick={onClose}
            disabled={!confirmed}
            className="w-full px-4 py-2.5 bg-kur-gradient text-white rounded-xl hover:brightness-110 transition-all text-sm font-semibold shadow-glow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Já anotei, fechar e apagar as palavras
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
