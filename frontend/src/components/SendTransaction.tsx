import { useState, useEffect, useRef } from 'react';
import { createSignedTransaction, getWalletVaultInfo } from '../api/client';
import { getStoredWallets, type StoredWallet } from '../utils/walletStorage';
import { useWallet } from '../context/WalletContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export default function SendTransaction({ isOpen, onClose, onSuccess, onError }: Props) {
  const { currentAddress } = useWallet();
  const [wallets, setWallets] = useState<StoredWallet[]>([]);
  const [selectedWallet, setSelectedWallet] = useState<string>('');
  const [receiver, setReceiver] = useState('');
  const [amount, setAmount] = useState('');
  const [fee, setFee] = useState('0.001');
  const [sending, setSending] = useState(false);
  /* Senha da carteira de origem: o nó decifra a chave com ela na hora de
     assinar e não guarda nada. Só aparece quando a carteira tem senha. */
  const [password, setPassword] = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  const [sendError, setSendError] = useState('');
  /* Etapa do modal: preenche os dados e só envia depois de conferir e
     confirmar o endereço de destino. */
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      const stored = getStoredWallets();
      setWallets(stored);
      setSelectedWallet('');
      setReceiver('');
      setAmount('');
      setFee('0.001');
      setStep('form');
      setSending(false);
      setPassword('');
      setHasPassword(false);
      setSendError('');
      // Carteira conectada já vem escolhida como origem.
      if (currentAddress && stored.some(w => w.address === currentAddress)) {
        setSelectedWallet(currentAddress);
      }
    }
  }, [isOpen, currentAddress]);

  // Pergunta ao nó se esta carteira pede senha (a chave fica lá).
  useEffect(() => {
    setSendError('');
    if (!selectedWallet) {
      setHasPassword(false);
      return;
    }
    let active = true;
    getWalletVaultInfo(selectedWallet)
      .then(info => { if (active) setHasPassword(!!info.has_password); })
      .catch(() => { if (active) setHasPassword(false); });
    return () => { active = false; };
  }, [selectedWallet]);

  const isEvmReceiver = /^0x[0-9a-fA-F]{40}$/.test(receiver.trim());
  const selected = wallets.find(w => w.address === selectedWallet);
  const originLabel = selected?.address || '';

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  /** Valida o formulário e avança para a confirmação. */
  const handleReview = () => {
    if (!selected) {
      onError('Selecione a carteira de origem.');
      return;
    }
    if (!receiver.trim()) {
      onError('Digite o endereço do destinatário.');
      return;
    }
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      onError('Digite um valor válido.');
      return;
    }
    const feeVal = parseFloat(fee);
    if (isNaN(feeVal) || feeVal < 0.001) {
      onError('Taxa mínima: 0.001 KUR.');
      return;
    }
    setStep('confirm');
  };

  const handleSend = async () => {
    // Só o endereço de origem vai para o servidor: a chave privada fica no
    // cofre do nó e é usada lá mesmo para assinar a transação.
    const payload = {
      from_address: selected?.address || '',
      password: hasPassword ? password : undefined,
      receiver: receiver.trim(),
      amount: parseFloat(amount),
      fee: parseFloat(fee),
    };

    setSending(true);
    setSendError('');
    try {
      const result = await createSignedTransaction(payload);
      onSuccess(`✅ ${result.message}`);
      onClose();
    } catch (err: any) {
      const code = err?.response?.data?.code;
      const msg = err?.response?.data?.error || err?.message || 'Erro ao criar transação';
      // Senha faltando/errada: fica na confirmação para o usuário corrigir.
      if (code === 'PASSWORD_REQUIRED' || code === 'WRONG_PASSWORD') {
        setHasPassword(true);
        setSendError(msg);
        if (code === 'WRONG_PASSWORD') setPassword('');
        return;
      }
      onError(`❌ ${msg}`);
      setStep('form');
    } finally {
      setSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div className="bg-kur-bg-card/95 backdrop-blur-xl border border-kur-border rounded-2xl w-full max-w-lg shadow-2xl shadow-glow-sm">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-kur-border">
          <div className="flex items-center gap-2">
            <span className="text-lg">{step === 'confirm' ? '🔎' : '💸'}</span>
            <h2 className="text-lg font-bold text-kur-text">
              {step === 'confirm' ? 'Confirmar Transação' : 'Enviar Transação'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-kur-text-muted hover:text-kur-text hover:bg-kur-bg-hover transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        {step === 'confirm' ? (
          <div className="px-6 py-5 space-y-4">
            <div className="bg-kur-accent/5 border border-kur-accent/20 rounded-xl p-4 space-y-3">
              <div>
                <p className="text-xs text-kur-text-muted">De</p>
                <p className="text-xs font-mono text-kur-text break-all">{originLabel}</p>
              </div>
              <div>
                <p className="text-xs text-kur-text-muted">Para</p>
                <p className="text-xs font-mono text-kur-text break-all">{receiver.trim()}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-kur-text-muted">Quantidade</p>
                  <p className="text-sm font-mono font-semibold text-kur-text">{amount} KUR</p>
                </div>
                <div>
                  <p className="text-xs text-kur-text-muted">Taxa</p>
                  <p className="text-sm font-mono font-semibold text-kur-text">{fee} KUR</p>
                </div>
              </div>
            </div>
            {hasPassword ? (
              <div>
                <label className="block text-sm font-medium text-kur-text mb-1.5">
                  Senha da carteira
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => { setPassword(e.target.value); setSendError(''); }}
                  placeholder="Senha definida ao criar/restaurar"
                  autoComplete="current-password"
                  autoFocus
                  className="w-full bg-kur-bg border border-kur-border rounded-lg px-3 py-2.5 text-sm text-kur-text placeholder-kur-text-muted focus:outline-none focus:border-kur-accent focus:shadow-glow-sm"
                />
                <p className="mt-1.5 text-xs text-kur-text-muted">
                  O nó usa a senha só para decifrar a chave nesta assinatura — ela não
                  fica guardada no navegador nem no servidor.
                </p>
                {sendError && <p className="mt-1.5 text-xs text-kur-red">{sendError}</p>}
              </div>
            ) : (
              <p className="text-xs text-kur-text-muted">
                Esta carteira não tem senha. Defina uma em <strong>Carteira</strong> para
                que ninguém envie só com o endereço.
              </p>
            )}
            <p className="text-xs text-kur-yellow">
              ⚠️ Confira o endereço de destino: uma transação enviada não pode ser desfeita.
            </p>
            {isEvmReceiver && (
              <p className="text-xs text-kur-text-muted">
                Destino EVM (Connect Wallet): os KUR também são creditados na KuramaChain EVM
                (chain 9090), onde a carteira consegue ver o saldo.
              </p>
            )}
          </div>
        ) : (
          <div className="px-6 py-5 space-y-4">
            {/* Wallet selector */}
            <div>
              <label className="block text-sm font-medium text-kur-text mb-1.5">
                Carteira de Origem
              </label>
              {wallets.length > 0 ? (
                <div>
                  <select
                    value={selectedWallet}
                    onChange={e => setSelectedWallet(e.target.value)}
                    className="w-full bg-kur-bg border border-kur-border rounded-lg px-3 py-2.5 text-sm text-kur-text focus:outline-none focus:border-kur-accent focus:shadow-glow-sm"
                  >
                    <option value="">Selecione uma carteira...</option>
                    {wallets.map(w => (
                      <option key={w.address} value={w.address}>
                        {w.label} — {w.address.slice(0, 16)}...
                      </option>
                    ))}
                  </select>
                  {selected && (
                    <p className="mt-1.5 text-xs text-kur-text-muted">
                      Origem:{' '}
                      <span className="font-mono text-kur-text">{selected.address}</span>
                    </p>
                  )}
                  {selected && (
                    <p className="mt-1.5 text-xs text-kur-text-muted">
                      A transação é assinada pelo nó para este endereço — a chave privada
                      não fica no navegador. Se a carteira foi criada em outra máquina,
                      restaure-a uma vez em <strong>Conectar</strong> com as 24 palavras.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-kur-text-muted">
                  Nenhuma carteira salva. Crie ou conecte uma carteira em{' '}
                  <strong>Conectar</strong> para enviar.
                </p>
              )}
            </div>

            {/* Receiver */}
            <div>
              <label className="block text-sm font-medium text-kur-text mb-1.5">
                Destinatário
              </label>
              <input
                value={receiver}
                onChange={e => setReceiver(e.target.value)}
                placeholder="Endereço da carteira de destino..."
                className="w-full bg-kur-bg border border-kur-border rounded-lg px-3 py-2.5 text-sm font-mono text-kur-text placeholder-kur-text-muted focus:outline-none focus:border-kur-accent focus:shadow-glow-sm"
              />
              {isEvmReceiver && (
                <p className="mt-1.5 text-xs text-kur-text-muted">
                  Destino EVM (Connect Wallet): os KUR também são creditados na KuramaChain EVM
                  (chain 9090), onde a carteira consegue ver o saldo.
                </p>
              )}
            </div>

            {/* Amount and Fee */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-kur-text mb-1.5">
                  Quantidade (KUR)
                </label>
                <input
                  type="number"
                  step="0.001"
                  min="0.001"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="10.0"
                  className="w-full bg-kur-bg border border-kur-border rounded-lg px-3 py-2.5 text-sm font-mono text-kur-text placeholder-kur-text-muted focus:outline-none focus:border-kur-accent focus:shadow-glow-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-kur-text mb-1.5">
                  Taxa (KUR)
                </label>
                <input
                  type="number"
                  step="0.001"
                  min="0.001"
                  value={fee}
                  onChange={e => setFee(e.target.value)}
                  className="w-full bg-kur-bg border border-kur-border rounded-lg px-3 py-2.5 text-sm font-mono text-kur-text placeholder-kur-text-muted focus:outline-none focus:border-kur-accent focus:shadow-glow-sm"
                />
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-kur-border">
          {step === 'confirm' ? (
            <>
              <button
                onClick={() => setStep('form')}
                disabled={sending}
                className="px-4 py-2 text-sm text-kur-text-muted hover:text-kur-text transition-colors disabled:opacity-50"
              >
                Voltar
              </button>
              <button
                onClick={handleSend}
                disabled={sending || (hasPassword && !password)}
                className="px-6 py-2.5 bg-kur-gradient text-white rounded-xl font-semibold shadow-glow-sm hover:brightness-110 transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {sending ? (
                  <>
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Enviando...
                  </>
                ) : (
                  'Confirmar e enviar'
                )}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-kur-text-muted hover:text-kur-text transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleReview}
                className="px-6 py-2.5 bg-kur-gradient text-white rounded-xl font-semibold shadow-glow-sm hover:brightness-110 transition-all text-sm"
              >
                Revisar transação
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
