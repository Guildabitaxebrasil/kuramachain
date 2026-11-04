/**
 * Swap do DEX da Kurama com recotação debounced.
 *
 * A cotação só roda quando existe valor válido; troca de token, valor, slippage
 * ou conta dispara nova cotação (400ms de debounce) e a resposta antiga é
 * descartada — sem corrida entre cotações.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PoolInfo, SwapQuote } from '../types/defi';
import { parseUnits } from '../api/dex';
import { findToken } from '../tokens/registry';
import { executeSwap, quoteSwap, type SwapExecution, type SwapStep } from '../services/swap';
import { errorMessage } from './useAsync';

export type SwapUiStep = 'idle' | 'quoting' | SwapStep | 'done';

export function useSwap(
  chainId: number,
  account: string | null,
  pools?: PoolInfo[],
) {
  const [tokenIn, setTokenIn] = useState('');
  const [tokenOut, setTokenOut] = useState('');
  const [amount, setAmount] = useState('');
  const [slippageBps, setSlippageBps] = useState(50);
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [step, setStep] = useState<SwapUiStep>('idle');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [result, setResult] = useState<SwapExecution | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    setTokenIn('');
    setTokenOut('');
    setAmount('');
    setQuote(null);
    setResult(null);
    setError(null);
    setWarning(null);
    setStep('idle');
  }, [chainId]);

  useEffect(() => {
    const current = seq.current + 1;
    seq.current = current;

    if (!tokenIn || !tokenOut || tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
      setQuote(null);
      return;
    }
    const metaIn = findToken(chainId, tokenIn);
    if (!metaIn) {
      setQuote(null);
      return;
    }

    let amountIn = 0n;
    try {
      amountIn = amount.trim() ? parseUnits(amount, metaIn.decimals) : 0n;
    } catch {
      setQuote(null);
      setError('Quantidade inválida');
      return;
    }
    if (amountIn === 0n) {
      setQuote(null);
      setError(null);
      setWarning(null);
      setStep((prev) => (prev === 'quoting' ? 'idle' : prev));
      return;
    }

    setStep((prev) => (prev === 'idle' || prev === 'done' ? 'quoting' : prev));
    const timer = window.setTimeout(async () => {
      try {
        const next = await quoteSwap({
          chainId,
          tokenIn,
          tokenOut,
          amountIn,
          slippageBps,
          account,
          pools,
        });
        if (seq.current !== current) return;
        setQuote(next);
        setError(null);
        setWarning(
          next.priceImpactPct !== null && next.priceImpactPct >= 5
            ? `Impacto de preço alto: ${next.priceImpactPct.toFixed(2)}%`
            : null,
        );
      } catch (err) {
        if (seq.current !== current) return;
        setQuote(null);
        setError(errorMessage(err));
        setWarning(null);
      } finally {
        if (seq.current === current) {
          setStep((prev) => (prev === 'quoting' ? 'idle' : prev));
        }
      }
    }, 400);

    return () => window.clearTimeout(timer);
  }, [chainId, tokenIn, tokenOut, amount, slippageBps, account, pools]);

  const execute = useCallback(async (): Promise<SwapExecution | null> => {
    if (!quote) return null;
    if (!account) throw new Error('Conecte a carteira para trocar');
    setError(null);
    setResult(null);
    try {
      const execution = await executeSwap(quote, account, (next) => setStep(next));
      setResult(execution);
      setStep('done');
      return execution;
    } catch (err) {
      setError(errorMessage(err));
      setStep('idle');
      return null;
    }
  }, [account, quote]);

  const flip = useCallback(() => {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setAmount('');
    setQuote(null);
  }, [tokenIn, tokenOut]);

  return {
    tokenIn,
    tokenOut,
    amount,
    slippageBps,
    quote,
    step,
    error,
    warning,
    result,
    setTokenIn,
    setTokenOut,
    setAmount,
    setSlippageBps,
    flip,
    execute,
    busy: step === 'quoting' || step === 'approving' || step === 'swapping' || step === 'confirming',
  };
}
