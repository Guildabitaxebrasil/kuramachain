/**
 * Notificações do terminal DeFi.
 *
 * Eventos cobertos: tx enviada, confirmada, falhou, aprovação necessária,
 * saldo insuficiente, slippage alto, preço alterado, RPC desconectado e rede
 * errada. Nada é disparado sem um evento real por trás.
 */
import React, { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

export type ToastKind = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  detail?: string;
}

interface ToastContextValue {
  toasts: Toast[];
  notify: (kind: ToastKind, title: string, detail?: string) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE: Record<ToastKind, { box: string; icon: string }> = {
  success: { box: 'bg-kur-green/10 border-kur-green/30 text-kur-green', icon: '✅' },
  error: { box: 'bg-kur-red/10 border-kur-red/30 text-kur-red', icon: '⛔' },
  warning: { box: 'bg-kur-yellow/10 border-kur-yellow/30 text-kur-yellow', icon: '⚠️' },
  info: { box: 'bg-kur-accent/10 border-kur-accent/30 text-kur-accent', icon: 'ℹ️' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);
  const timers = useRef<number[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback(
    (kind: ToastKind, title: string, detail?: string) => {
      counter.current += 1;
      const id = counter.current;
      setToasts((current) => [...current.slice(-4), { id, kind, title, detail }]);
      const timer = window.setTimeout(() => dismiss(id), kind === 'error' ? 9_000 : 5_500);
      timers.current.push(timer);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toasts, notify, dismiss }), [toasts, notify, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((toast) => {
          const tone = TONE[toast.kind];
          return (
            <div
              key={toast.id}
              role="status"
              className={`animate-slide-in rounded-xl border px-4 py-3 text-sm shadow-card backdrop-blur-xl ${tone.box}`}
            >
              <div className="flex items-start gap-2">
                <span aria-hidden>{tone.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium leading-snug">{toast.title}</p>
                  {toast.detail && (
                    <p className="mt-0.5 break-words text-[11px] text-kur-text-muted">{toast.detail}</p>
                  )}
                </div>
                <button
                  onClick={() => dismiss(toast.id)}
                  className="rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
                  aria-label="Fechar notificação"
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast precisa estar dentro de <ToastProvider>');
  return ctx;
}
