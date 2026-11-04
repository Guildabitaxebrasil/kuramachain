/**
 * Swap do DEX da Kurama: rotas, cotação, aprovação e execução.
 *
 * Não existe `getAmountsOut` no `KurRouter`, então a cotação é feita em cima do
 * grafo de pares do `KurFactory`: rota direta e rotas de 2 saltos (via KUR,
 * WKUR ou qualquer token intermediário que tenha par com os dois lados). A
 * melhor cotação vence, e a UI mostra as alternativas.
 *
 * A escrita é assinada pela wallet (`eth_sendTransaction`): `approve` no token
 * de entrada quando a allowance é insuficiente e depois
 * `swapExactTokensForTokens(amountIn, amountOutMin, path, to)`.
 */
import type { PoolInfo, RouteHop, SwapAlternative, SwapQuote, TokenMeta } from '../types/defi';
import { FN } from '../abi/selectors';
import { encodeApprove, encodeAddress, sameAddress, isAddress } from '../abi/coders';
import { encodeSwapExactTokensForTokens } from '../api/evmAbi';
import { applySlippage, quoteAmountOut } from '../api/dex';
import {
  ensureChain,
  getEvmProvider,
  kuramaChainParams,
  sendWalletTransaction,
  waitForTransactionReceipt,
} from '../api/evmWallet';
import { KURAMA_CHAIN_ID } from '../chains/chains';
import { contractAddress } from '../contracts/registry';
import { estimateGas, invalidateRpcCache, readUint } from './rpc';
import { loadPools, loadTokenMeta } from './pools';

export interface QuoteRequest {
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  slippageBps: number;
  account?: string | null;
  pools?: PoolInfo[];
}

interface Route {
  tokens: string[];
  pools: PoolInfo[];
  label: string;
}

function toNumber(value: bigint, decimals: number): number {
  return Number(value) / 10 ** decimals;
}

function hopReserves(pool: PoolInfo, tokenIn: string, tokenOut: string): {
  reserveIn: bigint;
  reserveOut: bigint;
  decimalsIn: number;
  decimalsOut: number;
} {
  const inIsToken0 = sameAddress(pool.token0.address, tokenIn);
  return {
    reserveIn: inIsToken0 ? pool.reserve0 : pool.reserve1,
    reserveOut: inIsToken0 ? pool.reserve1 : pool.reserve0,
    decimalsIn: inIsToken0 ? pool.token0.decimals : pool.token1.decimals,
    decimalsOut: inIsToken0 ? pool.token1.decimals : pool.token0.decimals,
  };
}

function quoteHop(pool: PoolInfo, tokenIn: string, tokenOut: string, amountIn: bigint): bigint {
  const { reserveIn, reserveOut } = hopReserves(pool, tokenIn, tokenOut);
  return quoteAmountOut(amountIn, reserveIn, reserveOut);
}

function midPrice(pool: PoolInfo, tokenIn: string, tokenOut: string): number | null {
  const { reserveIn, reserveOut, decimalsIn, decimalsOut } = hopReserves(pool, tokenIn, tokenOut);
  const humanIn = toNumber(reserveIn, decimalsIn);
  const humanOut = toNumber(reserveOut, decimalsOut);
  if (humanIn <= 0 || humanOut <= 0) return null;
  return humanOut / humanIn;
}

/** Rotas candidatas: direta + 2 saltos por token intermediário. */
export function buildRoutes(
  pools: PoolInfo[],
  tokenIn: string,
  tokenOut: string,
): Route[] {
  const routes: Route[] = [];
  const findPool = (a: string, b: string) =>
    pools.find(
      (pool) =>
        (sameAddress(pool.token0.address, a) && sameAddress(pool.token1.address, b)) ||
        (sameAddress(pool.token0.address, b) && sameAddress(pool.token1.address, a)),
    );

  const direct = findPool(tokenIn, tokenOut);
  if (direct) {
    routes.push({
      tokens: [tokenIn, tokenOut],
      pools: [direct],
      label: 'Pool direta',
    });
  }

  const tokensOf = (pool: PoolInfo) => [pool.token0.address, pool.token1.address];
  const midCandidates = new Set<string>();
  pools.forEach((pool) => {
    const [a, b] = tokensOf(pool);
    if (sameAddress(a, tokenIn)) midCandidates.add(b);
    if (sameAddress(b, tokenIn)) midCandidates.add(a);
  });

  for (const mid of midCandidates) {
    if (sameAddress(mid, tokenIn) || sameAddress(mid, tokenOut)) continue;
    const first = findPool(tokenIn, mid);
    const second = findPool(mid, tokenOut);
    if (!first || !second) continue;
    routes.push({
      tokens: [tokenIn, mid, tokenOut],
      pools: [first, second],
      label: `2 saltos (${mid.slice(0, 6)}…)`,
    });
  }

  return routes;
}

function routeLabel(pools: PoolInfo[], tokens: string[]): string {
  const symbols = tokens.map((address) => {
    for (const pool of pools) {
      if (sameAddress(pool.token0.address, address)) return pool.token0.symbol;
      if (sameAddress(pool.token1.address, address)) return pool.token1.symbol;
    }
    return address.slice(0, 6);
  });
  return `${symbols.join(' → ')} · ${pools.length === 1 ? 'pool direta' : `${pools.length - 1} salto(s)`}`;
}

function buildHops(route: Route, amountIn: bigint): { hops: RouteHop[]; amountOut: bigint } {
  let current = amountIn;
  const hops: RouteHop[] = [];
  for (let index = 0; index < route.pools.length; index += 1) {
    const pool = route.pools[index];
    const tokenIn = route.tokens[index];
    const tokenOut = route.tokens[index + 1];
    const amountOut = quoteHop(pool, tokenIn, tokenOut, current);
    const metaIn: TokenMeta = sameAddress(pool.token0.address, tokenIn) ? pool.token0 : pool.token1;
    const metaOut: TokenMeta = sameAddress(pool.token0.address, tokenOut) ? pool.token0 : pool.token1;
    hops.push({
      tokenIn: metaIn,
      tokenOut: metaOut,
      pair: pool.address,
      protocol: 'KurFactory (x*y=k)',
      amountIn: current,
      amountOut,
      feeBps: 30,
    });
    current = amountOut;
  }
  return { hops, amountOut: current };
}

/** Cotação completa com a melhor rota entre as disponíveis. */
export async function quoteSwap(request: QuoteRequest): Promise<SwapQuote> {
  const { chainId, tokenIn, tokenOut, amountIn, slippageBps, account } = request;
  if (chainId !== KURAMA_CHAIN_ID) {
    throw new Error('Swap do KurRouter só está habilitado na KuramaChain (9090)');
  }
  if (!isAddress(tokenIn) || !isAddress(tokenOut)) throw new Error('Endereços de token inválidos');
  if (sameAddress(tokenIn, tokenOut)) throw new Error('Escolha dois tokens diferentes');
  if (amountIn <= 0n) throw new Error('Informe uma quantidade maior que zero');

  const pools = request.pools ?? (await loadPools(chainId));
  const routes = buildRoutes(pools, tokenIn, tokenOut);
  if (!routes.length) {
    throw new Error('Não existe par com liquidez para esse caminho no KurFactory');
  }

  const [metaIn, metaOut] = await Promise.all([
    loadTokenMeta(chainId, tokenIn),
    loadTokenMeta(chainId, tokenOut),
  ]);

  const evaluated = routes
    .map((route) => {
      const { hops, amountOut } = buildHops(route, amountIn);
      return { route, hops, amountOut };
    })
    .filter((item) => item.amountOut > 0n)
    .sort((a, b) => (a.amountOut === b.amountOut ? 0 : a.amountOut > b.amountOut ? -1 : 1));

  if (!evaluated.length) {
    throw new Error('Liquidez insuficiente para essa quantidade');
  }

  const best = evaluated[0];
  const mid = best.route.pools.reduce<number | null>((acc, pool, index) => {
    const hop = midPrice(pool, best.route.tokens[index], best.route.tokens[index + 1]);
    if (hop === null) return null;
    return acc === null ? hop : acc * hop;
  }, null);
  const exec = toNumber(best.amountOut, metaOut.decimals) / toNumber(amountIn, metaIn.decimals);
  const priceImpactPct = mid && mid > 0 ? Math.max(0, (1 - exec / mid) * 100) : null;

  const router = contractAddress(chainId, 'router');
  let allowance = 0n;
  if (account && router) {
    allowance = await readUint(
      chainId,
      tokenIn,
      FN.allowance + encodeAddress(account) + encodeAddress(router),
      0,
      3_000,
    );
  }

  let gasEstimate: bigint | null = null;
  if (account && router) {
    try {
      gasEstimate = await estimateGas(chainId, account, {
        to: router,
        data: encodeSwapExactTokensForTokens(
          amountIn,
          applySlippage(best.amountOut, slippageBps),
          [tokenIn, tokenOut],
          account,
        ),
      });
    } catch {
      gasEstimate = null;
    }
  }

  const alternatives: SwapAlternative[] = evaluated.slice(1, 4).map((item) => ({
    label: item.route.label,
    amountOut: item.amountOut,
  }));

  return {
    chainId,
    dex: 'kur',
    tokenIn: metaIn,
    tokenOut: metaOut,
    amountIn,
    amountOut: best.amountOut,
    amountOutMin: applySlippage(best.amountOut, slippageBps),
    hops: best.hops,
    routeLabel: routeLabel(best.route.pools, best.route.tokens),
    execPrice: exec,
    midPrice: mid,
    priceImpactPct,
    protocolFeeBps: 30 * best.route.pools.length,
    allowance,
    needsApproval: !!account && allowance < amountIn,
    gasEstimate,
    alternatives: alternatives.map((alt) => ({
      ...alt,
      label: alt.label + ' · ' + (alt.amountOut < best.amountOut ? 'pior' : ''),
    })),
    slippageBps,
  };
}

export interface SwapExecution {
  approveTx?: string;
  swapTx: string;
  amountOut: bigint | null;
  status: 'confirmed' | 'failed' | 'pending';
}

export type SwapStep = 'approving' | 'swapping' | 'confirming';

/**
 * Executa o swap já cotado.
 *
 * Revalida o mínimo na hora de assinar: se o preço andou além do slippage a
 * transação reverteria e o usuário perderia gas — então abortamos antes.
 */
export async function executeSwap(
  quote: SwapQuote,
  account: string,
  onStep?: (step: SwapStep) => void,
): Promise<SwapExecution> {
  if (!getEvmProvider()) throw new Error('Carteira EVM não encontrada no navegador');
  const router = contractAddress(quote.chainId, 'router');
  if (!router) throw new Error('KurRouter não configurado');

  await ensureChain(KURAMA_CHAIN_ID, kuramaChainParams());

  // Revalida o preço imediatamente antes de assinar: se o pool andou além do
  // slippage, a tx reverteria e o usuário perderia gas.
  const fresh = await quoteSwap({
    chainId: quote.chainId,
    tokenIn: quote.tokenIn.address,
    tokenOut: quote.tokenOut.address,
    amountIn: quote.amountIn,
    slippageBps: quote.slippageBps,
    account,
  });
  if (fresh.amountOut < quote.amountOutMin) {
    throw new Error('Preço mudou além do slippage — recote antes de trocar');
  }

  let approveTx: string | undefined;
  if (quote.needsApproval) {
    onStep?.('approving');
    approveTx = await sendWalletTransaction({
      from: account,
      to: quote.tokenIn.address,
      data: encodeApprove(router, quote.amountIn),
    });
    const receipt = await waitForTransactionReceipt(approveTx, 90_000);
    if (!receipt || receipt.status !== '0x1') {
      throw new Error('A aprovação falhou ou não foi confirmada');
    }
  }

  onStep?.('swapping');
  const swapTx = await sendWalletTransaction({
    from: account,
    to: router,
    data: encodeSwapExactTokensForTokens(
      quote.amountIn,
      fresh.amountOutMin,
      [quote.tokenIn.address, quote.tokenOut.address],
      account,
    ),
  });

  onStep?.('confirming');
  const receipt = await waitForTransactionReceipt(swapTx, 120_000);
  invalidateRpcCache();

  return {
    approveTx,
    swapTx,
    amountOut: fresh.amountOut,
    status: !receipt ? 'pending' : receipt.status === '0x1' ? 'confirmed' : 'failed',
  };
}
