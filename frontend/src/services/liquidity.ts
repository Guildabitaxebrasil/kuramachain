/**
 * Liquidez do AMM da Kurama.
 *
 * - **Adicionar**: `KurRouter.addLiquidity(tokenA, tokenB, amountA, amountB, to)`
 *   (exige approve dos dois tokens para o router).
 * - **Remover**: o `KurPair` só queima o LP que está no próprio par
 *   (`balanceOf[address(this)]`), então a remoção é transferir o LP para o par e
 *   chamar `burn(account)` — duas transações, como no Uniswap V2.
 */
import type { PoolInfo } from '../types/defi';
import { FN } from '../abi/selectors';
import { encodeAddLiquidity, encodeApprove, encodeBurn, encodeTransfer } from '../abi/coders';
import { contractAddress } from '../contracts/registry';
import { readUint } from './rpc';
import { sendAndWait } from './tx';

export interface LiquidityResult {
  approveA?: string;
  approveB?: string;
  tx: string;
  status: 'confirmed' | 'failed' | 'pending';
}

async function approveIfNeeded(
  chainId: number,
  account: string,
  token: string,
  spender: string,
  amount: bigint,
): Promise<string | undefined> {
  const allowance = await readUint(
    chainId,
    token,
    FN.allowance + account.slice(2).padStart(64, '0') + spender.slice(2).padStart(64, '0'),
    0,
    2_000,
  );
  if (allowance >= amount) return undefined;
  const sent = await sendAndWait(chainId, {
    from: account,
    to: token,
    data: encodeApprove(spender, amount),
  });
  if (sent.status === 'failed') throw new Error('A aprovação do token falhou');
  return sent.hash;
}

export async function addLiquidity(
  chainId: number,
  account: string,
  pool: PoolInfo,
  amount0: bigint,
  amount1: bigint,
): Promise<LiquidityResult> {
  const router = contractAddress(chainId, 'router');
  if (!router) throw new Error('KurRouter não configurado');
  if (amount0 <= 0n || amount1 <= 0n) throw new Error('Informe as duas quantidades');

  const approveA = await approveIfNeeded(chainId, account, pool.token0.address, router, amount0);
  const approveB = await approveIfNeeded(chainId, account, pool.token1.address, router, amount1);
  const sent = await sendAndWait(chainId, {
    from: account,
    to: router,
    data: encodeAddLiquidity(pool.token0.address, pool.token1.address, amount0, amount1, account),
  });
  return {
    approveA,
    approveB,
    tx: sent.hash,
    status: sent.status,
  };
}

export async function removeLiquidity(
  chainId: number,
  account: string,
  pool: PoolInfo,
  lpAmount: bigint,
): Promise<LiquidityResult> {
  if (lpAmount <= 0n) throw new Error('Quantidade de LP inválida');
  const transfer = await sendAndWait(chainId, {
    from: account,
    to: pool.address,
    data: encodeTransfer(pool.address, lpAmount),
  });
  if (transfer.status === 'failed') throw new Error('Falha ao transferir o LP para o par');
  const burn = await sendAndWait(chainId, {
    from: account,
    to: pool.address,
    data: encodeBurn(account),
  });
  return { tx: burn.hash, status: burn.status };
}

/**
 * Quantidade do segundo token para manter a proporção do pool.
 *
 * `null` quando o pool não tem reservas (primeira liquidez é livre).
 */
export function quoteCounterpart(pool: PoolInfo, amount0: bigint): bigint | null {
  if (pool.reserve0 === 0n || pool.reserve1 === 0n) return null;
  return (amount0 * pool.reserve1) / pool.reserve0;
}
