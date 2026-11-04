/**
 * `useAsync` — base de todos os hooks DeFi.
 *
 * Garante: estado consistente (loading/refreshing/erro), polling controlado,
 * resposta de requisição antiga descartada (`seq`) e nenhum `setState` depois do
 * unmount (evita warning de componente desmontado / race condition).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  const raw = err as { message?: string; response?: { data?: { error?: string } } };
  return raw?.response?.data?.error || raw?.message || 'Erro inesperado';
}

export interface UseAsyncOptions {
  pollMs?: number;
  enabled?: boolean;
}

export function useAsync<T>(
  fn: () => Promise<T>,
  deps: unknown[],
  options: UseAsyncOptions = {},
): AsyncState<T> & { refresh: () => void } {
  const { pollMs, enabled = true } = options;
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    error: null,
    loading: enabled,
    refreshing: false,
  });
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const refresh = useCallback(() => setTick((current) => current + 1), []);

  useEffect(() => {
    if (!enabled) {
      // Só mexe no estado se houver algo a limpar; `setState` com um objeto novo
      // a cada render (deps instáveis, ex.: `data ?? []`) recriava o efeito e
      // entrava em loop de render na tela.
      setState((prev) =>
        prev.loading || prev.refreshing ? { ...prev, loading: false, refreshing: false } : prev,
      );
      return;
    }
    const id = seq.current + 1;
    seq.current = id;
    let cancelled = false;
    let timer: number | undefined;

    const run = async (initial: boolean) => {
      if (cancelled) return;
      setState((prev) => ({
        ...prev,
        loading: initial && prev.data === null,
        refreshing: !initial,
      }));
      try {
        const data = await fnRef.current();
        if (cancelled || seq.current !== id) return;
        setState({ data, error: null, loading: false, refreshing: false });
      } catch (err) {
        if (cancelled || seq.current !== id) return;
        setState((prev) => ({
          ...prev,
          error: errorMessage(err),
          loading: false,
          refreshing: false,
        }));
      }
    };

    void run(true);
    if (pollMs) {
      timer = window.setInterval(() => {
        void run(false);
      }, pollMs);
    }
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, enabled, pollMs]);

  return { ...state, refresh };
}
