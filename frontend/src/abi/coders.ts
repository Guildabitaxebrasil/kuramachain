/**
 * Encoders/decoders ABI usados pelos serviços DeFi.
 *
 * Reaproveita o código sem dependências de `api/evmAbi.ts` (o mesmo que o DEX
 * já usa) e acrescenta o que os outros contratos precisam: `balanceOf`,
 * `allowance`, `addLiquidity`, `burn`, arrays de endereços e `int256`.
 */
import {
  decodeAddress,
  decodeString,
  decodeTokenString,
  decodeUint,
  decodeWord,
  encodeAddress,
  encodeApprove,
  encodeGetPair,
  isAddress,
  isZeroAddress,
  sameAddress,
  word,
} from '../api/evmAbi';
import { FN } from './selectors';

export {
  decodeAddress,
  decodeString,
  decodeTokenString,
  decodeUint,
  decodeWord,
  encodeAddress,
  encodeApprove,
  encodeGetPair,
  isAddress,
  isZeroAddress,
  sameAddress,
  word,
};

function body(data: string): string {
  return data.startsWith('0x') || data.startsWith('0X') ? data.slice(2) : data;
}

/** Concatena seletor + palavras ABI (hex sem `0x` já formatado por `word`). */
export function encodeCall(selector: string, ...words: string[]): string {
  return selector + words.join('');
}

export function encodeBalanceOf(owner: string): string {
  return encodeCall(FN.balanceOf, encodeAddress(owner));
}

export function encodeAllowance(owner: string, spender: string): string {
  return encodeCall(FN.allowance, encodeAddress(owner), encodeAddress(spender));
}

export function encodeTransfer(to: string, amount: bigint): string {
  return encodeCall(FN.transfer, encodeAddress(to), word(amount));
}

/** `getReserves()` não recebe argumentos. */
export function encodeGetReserves(): string {
  return FN.getReserves;
}

/** `addLiquidity(tokenA, tokenB, amountA, amountB, to)`. */
export function encodeAddLiquidity(
  tokenA: string,
  tokenB: string,
  amountA: bigint,
  amountB: bigint,
  to: string,
): string {
  return encodeCall(
    FN.addLiquidity,
    encodeAddress(tokenA),
    encodeAddress(tokenB),
    word(amountA),
    word(amountB),
    encodeAddress(to),
  );
}

/** `burn(address to)` no KurPair (remove liquidez; exige LP transferido ao par). */
export function encodeBurn(to: string): string {
  return encodeCall(FN.burn, encodeAddress(to));
}

export function encodeUintCall(selector: string, value: bigint | number): string {
  return encodeCall(selector, word(value));
}

export function encodeAddressUintCall(
  selector: string,
  address: string,
  value: bigint | number,
): string {
  return encodeCall(selector, encodeAddress(address), word(value));
}

export function encodeTwoUintCall(
  selector: string,
  a: bigint | number,
  b: bigint | number,
): string {
  return encodeCall(selector, word(a), word(b));
}

export function encodeAddressAddressCall(selector: string, a: string, b: string): string {
  return encodeCall(selector, encodeAddress(a), encodeAddress(b));
}

export function encodeDepositBridge(
  token: string,
  amount: bigint,
  destChain: number,
  recipient: string,
): string {
  return encodeCall(
    FN.depositBridge,
    encodeAddress(token),
    word(amount),
    word(destChain),
    encodeAddress(recipient),
  );
}

/** `int256` (two's complement) de uma palavra ABI. */
export function decodeInt(data: string, index = 0): bigint {
  const value = decodeWord(data, index);
  const max = 1n << 255n;
  return value >= max ? value - (1n << 256n) : value;
}

/** `address[]` dinâmico (offset + tamanho + itens). */
export function decodeAddressArray(data: string): string[] {
  const raw = body(data);
  if (raw.length < 128) return [];
  const offset = Number(decodeWord(data, 0)) * 2;
  if (offset + 64 > raw.length) return [];
  const length = Number(decodeWord('0x' + raw.slice(offset), 0));
  const out: string[] = [];
  for (let i = 0; i < length; i += 1) {
    const start = offset + 64 + i * 64;
    if (start + 64 > raw.length) break;
    out.push('0x' + raw.slice(start + 24, start + 64));
  }
  return out;
}

/** Lê as `n` primeiras palavras como `uint256`. */
export function decodeUintTuple(data: string, n: number): bigint[] {
  const out: bigint[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push(decodeWord(data, i));
  }
  return out;
}

/** `string` opcional: devolve `null` quando o retorno está vazio. */
export function decodeOptionalString(data: string): string | null {
  if (!data || data === '0x') return null;
  try {
    const text = decodeTokenString(data);
    return text || null;
  } catch {
    return null;
  }
}
