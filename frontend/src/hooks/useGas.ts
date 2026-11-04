import { rpc } from '../services/rpc';
import { useAsync } from './useAsync';

/** `eth_gasPrice` da rede ativa (wei), com polling curto. */
export function useGasPrice(chainId: number, pollMs = 20_000) {
  return useAsync(
    async () => {
      const hex = await rpc<string>(chainId, 'eth_gasPrice', [], { timeoutMs: 8_000 });
      return BigInt(hex ?? '0x0');
    },
    [chainId],
    { pollMs },
  );
}

export function formatGwei(value: bigint | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const gwei = Number(value) / 1e9;
  if (!Number.isFinite(gwei)) return '—';
  return `${gwei.toLocaleString('pt-BR', { maximumFractionDigits: gwei < 1 ? 4 : 2 })} gwei`;
}
