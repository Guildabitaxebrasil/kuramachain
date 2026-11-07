import { useState, useEffect, useRef } from 'react';
import { createSignedTransaction } from '../api/client';
import { getStoredWallets, type StoredWallet } from '../utils/walletStorage';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export default function SendTransaction({ isOpen, onClose, onSuccess, onError }: Props) {
  const [wallets, setWallets] = useState<StoredWallet[]>([]);
  const [selectedWallet, setSelectedWallet] = useState<string>('');
  const [receiver, setReceiver] = useState('');
  const [amount, setAmount] = useState('');
  const [fee, setFee] = useState('0.001');
  const [sending, setSending] = useState(false);
  const [customPk, setCustomPk] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const [mode, setMode] = useState<'wallets' | 'pem' | 'mnemonic'>('wallets');
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      const stored = getStoredWallets();
      setWallets(stored);
      setSelectedWallet('');
      setReceiver('');
      setAmount('');
      setFee('0.001');
      setCustomPk('');
      setMnemonic('');
      // Carteira salva sem chave privada não consegue assinar: nesse caso
      // a frase de recuperação é o único caminho que funciona.
      setMode(stored.some(w => w.private_key_pem) ? 'wallets' : 'mnemonic');
      setSending(false);
    }
  }, [isOpen]);

  const isEvmReceiver = /^0x[0-9a-fA-F]{40}$/.test(receiver.trim());
  const selected = wallets.find(w => w.address === selectedWallet);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  const handleSend = async () => {
    let payload: { private_key_pem?: string; mnemonic?: string };

    if (mode === 'pem') {
      const pk = customPk.trim();
      if (!pk) {
        onError('Cole a chave privada (PEM) da carteira de origem.');
        return;
      }
      payload = { private_key_pem: pk };
    } else if (mode === 'mnemonic') {
      const words = mnemonic.trim().split(/\s+/).filter(Boolean);
      if (words.length !== 24) {
        onError('Digite as 24 palavras da frase de recuperação da carteira de origem.');
        return;
      }
      payload = { mnemonic: words.join(' ') };
    } else {
      if (!selected) {
        onError('Selecione a carteira de origem.');
        return;
      }
      if (!selected.private_key_pem) {
        onError(
          'Esta carteira foi salva sem a chave privada (o nó não a devolve). ' +
          'Use a aba "Frase de recuperação" com as 24 palavras dela para enviar.'
        );
        return;
      }
      payload = { private_key_pem: selected.private_key_pem };
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

    setSending(true);
    try {
      const result = await createSignedTransaction({
        ...payload,
        receiver: receiver.trim(),
        amount: amt,
        fee: feeVal,
      });
      onSuccess(`✅ ${result.message}`);
      onClose();
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Erro ao criar transação';
      onError(`❌ ${msg}`);
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
            <span className="text-lg">💸</span>
            <h2 className="text-lg font-bold text-kur-text">Enviar Transação</h2>
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
        <div className="px-6 py-5 space-y-4">
          {/* Wallet selector */}
          <div>
            <label className="block text-sm font-medium text-kur-text mb-1.5">
              Carteira de Origem
            </label>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              {([
                ['wallets', 'Suas carteiras'],
                ['pem', 'Chave privada'],
                ['mnemonic', 'Frase de recuperação'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setMode(value)}
                  className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                    mode === value
                      ? 'bg-kur-accent/20 text-kur-accent border border-kur-accent/30'
                      : 'bg-kur-bg text-kur-text-muted border border-kur-border'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {mode === 'pem' ? (
              <textarea
                value={customPk}
                onChange={e => setCustomPk(e.target.value)}
                placeholder="Cole a chave privada (PEM)..."
                rows={3}
                className="w-full bg-kur-bg border border-kur-border rounded-lg px-3 py-2 text-xs font-mono text-kur-text placeholder-kur-text-muted focus:outline-none focus:border-kur-accent focus:shadow-glow-sm resize-none"
              />
            ) : mode === 'mnemonic' ? (
              <div>
                <textarea
                  value={mnemonic}
                  onChange={e => setMnemonic(e.target.value)}
                  placeholder="As 24 palavras da carteira de origem, separadas por espaço..."
                  rows={3}
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full bg-kur-bg border border-kur-border rounded-lg px-3 py-2 text-xs font-mono text-kur-text placeholder-kur-text-muted focus:outline-none focus:border-kur-accent focus:shadow-glow-sm resize-none"
                />
                <p className="mt-1.5 text-xs text-kur-text-muted">
                  A frase só é usada para assinar esta transação: o nó não a
                  grava e ela não fica salva no navegador.
                </p>
              </div>
            ) : wallets.length > 0 ? (
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
                {selected && !selected.private_key_pem && (
                  <p className="mt-1.5 text-xs text-kur-yellow">
                    Esta carteira foi salva sem a chave privada. Use a aba
                    <strong> Frase de recuperação</strong> com as 24 palavras dela
                    para poder enviar.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-kur-text-muted">
                Nenhuma carteira salva. Use a aba <strong>Frase de recuperação</strong> com
                as 24 palavras da sua carteira.
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

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-kur-border">
          <button
            onClick={onClose}
            disabled={sending}
            className="px-4 py-2 text-sm text-kur-text-muted hover:text-kur-text transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSend}
            disabled={sending}
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
              'Enviar Transação'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
