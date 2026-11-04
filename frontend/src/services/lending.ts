/**
 * Lending (`KurLendingPool`) — reservas, APYs, posição e ações.
 *
 * Todos os números vêm do contrato: `getReservesList`, `getReserveData`,
 * `getReserveConfigurationData` e `getUserAccountData`. A taxa é anualizada a
 * partir da taxa por segundo em ray (`1e27`). O preço usado é o do
 * `KurPriceOracle` do pool (18 decimais) — sem oráculo, a reserva fica sem USD.
 */
import type { LendingAccount, LendingReserve, TokenMeta } from '../types/defi';
import { FN } from '../abi/selectors';
import { decodeAddressArray, encodeAddress, encodeApprove, word } from '../abi/coders';
import { ethCall, readAddress, readUint } from './rpc';
import { contractAddress } from '../contracts/registry';
import { getTokenUsd, toNumber } from './prices';
import { loadTokenMeta } from './pools';
import { sendAndWait } from './tx';

const RAY = 1e27;
const SECONDS_PER_YEAR = 31_536_000;

export interface LendingData {
  configured: boolean;
  pool: string;
  reserves: LendingReserve[];
  account: LendingAccount | null;
  closeFactorBps: number | null;
  priceOracle: string | null;
}

function wordsOf(hex: string): bigint[] {
  const body = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out: bigint[] = [];
  for (let i = 0; i + 64 <= body.length; i += 64) {
    out.push(BigInt('0x' + body.slice(i, i + 64)));
  }
  return out;
}

function addressAt(words: bigint[], index: number): string {
  const value = words[index] ?? 0n;
  return '0x' + value.toString(16).padStart(40, '0').slice(-40);
}

export async function loadLending(
  chainId: number,
  account?: string | null,
): Promise<LendingData> {
  const pool = contractAddress(chainId, 'lendingPool');
  if (!pool) {
    return {
      configured: false,
      pool: '',
      reserves: [],
      account: null,
      closeFactorBps: null,
      priceOracle: null,
    };
  }

  const [listRaw, closeFactorRaw, oracleRaw] = await Promise.all([
    ethCall(chainId, pool, FN.getReservesList, 15_000),
    readUint(chainId, pool, FN.closeFactor, 0, 60_000).catch(() => null),
    readAddress(chainId, pool, FN.priceOracle, 60_000).catch(() => ''),
  ]);
  const assets = decodeAddressArray(listRaw);
  const priceOracle = oracleRaw || null;

  const reserves: LendingReserve[] = [];
  for (const asset of assets) {
    try {
      const [configRaw, dataRaw, myRaw, meta] = await Promise.all([
        ethCall(chainId, pool, FN.getReserveConfigurationData + encodeAddress(asset), 10_000),
        ethCall(chainId, pool, FN.getReserveData + encodeAddress(asset), 10_000),
        account
          ? ethCall(chainId, pool, FN.getUserReserveData + encodeAddress(account) + encodeAddress(asset), 5_000)
          : Promise.resolve('0x'),
        loadTokenMeta(chainId, asset),
      ]);
      const config = wordsOf(configRaw);
      const data = wordsOf(dataRaw);
      if (config.length < 7 || data.length < 6) continue;

      const aToken = addressAt(config, 0);
      const debtToken = addressAt(config, 1);
      const ltvBps = Number(config[3]);
      const thresholdBps = Number(config[4]);
      const bonusBps = Number(config[5]);
      const reserveFactorBps = Number(config[6]);

      const totalBorrows = data[2];
      const available = data[3];
      const utilization = Number(data[4]) / RAY;
      const borrowRatePerSecond = Number(data[5]) / RAY;
      const borrowApy = borrowRatePerSecond * SECONDS_PER_YEAR * 100;
      const supplyApy =
        borrowApy * utilization * (1 - reserveFactorBps / 10_000);

      const my = wordsOf(myRaw);

      let priceUsd: number | null = null;
      if (priceOracle) {
        try {
          const priceRaw = await readUint(chainId, priceOracle, FN.getAssetPrice + encodeAddress(asset), 0, 20_000);
          priceUsd = toNumber(priceRaw, 18);
          if (!Number.isFinite(priceUsd) || priceUsd <= 0) priceUsd = null;
        } catch {
          priceUsd = null;
        }
      }
      if (priceUsd === null) {
        priceUsd = (await getTokenUsd(chainId, asset)).usd;
      }

      reserves.push({
        asset: meta as TokenMeta,
        aToken,
        debtToken,
        ltvBps,
        thresholdBps,
        bonusBps,
        reserveFactorBps,
        supplied: available + totalBorrows,
        borrowed: totalBorrows,
        available,
        utilizationPct: Number.isFinite(utilization) ? utilization * 100 : null,
        supplyApyPct: Number.isFinite(supplyApy) ? supplyApy : null,
        borrowApyPct: Number.isFinite(borrowApy) ? borrowApy : null,
        priceUsd,
        mySupplied: my[0] ?? 0n,
        myDebt: my[1] ?? 0n,
      });
    } catch {
      // reserva ilegível: ignora e segue
    }
  }

  let lendingAccount: LendingAccount | null = null;
  if (account) {
    try {
      const raw = await ethCall(chainId, pool, FN.getUserAccountData + encodeAddress(account), 8_000);
      const words = wordsOf(raw);
      if (words.length >= 6) {
        const maxUint = (1n << 256n) - 1n;
        const debt = words[1];
        const health = words[5];
        lendingAccount = {
          collateralUsd: toNumber(words[0], 18),
          debtUsd: toNumber(debt, 18),
          availableBorrowUsd: toNumber(words[2], 18),
          liquidationThresholdBps: Number(words[3]),
          ltvBps: Number(words[4]),
          healthFactor: debt === 0n || health === maxUint ? null : toNumber(health, 18),
          hasDebt: debt > 0n,
        };
      }
    } catch {
      lendingAccount = null;
    }
  }

  return {
    configured: true,
    pool,
    reserves,
    account: lendingAccount,
    closeFactorBps: closeFactorRaw === null ? null : Number(closeFactorRaw),
    priceOracle,
  };
}

// ─── Ações ───────────────────────────────────────────────────────────

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
    FN.allowance + encodeAddress(account) + encodeAddress(spender),
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

export interface LendingResult {
  approveTx?: string;
  tx: string;
  status: 'confirmed' | 'failed' | 'pending';
}

type Action = 'supply' | 'withdraw' | 'borrow' | 'repay';

export async function lendingAction(
  chainId: number,
  account: string,
  action: Action,
  asset: string,
  amount: bigint,
): Promise<LendingResult> {
  const pool = contractAddress(chainId, 'lendingPool');
  if (!pool) throw new Error('KurLendingPool não configurado');
  if (amount < 0n) throw new Error('Quantidade inválida');
  if (action !== 'withdraw' && amount === 0n) throw new Error('Quantidade inválida');

  let approveTx: string | undefined;
  if (action === 'supply' || action === 'repay') {
    approveTx = await approveIfNeeded(chainId, account, asset, pool, amount);
  }

  const selector =
    action === 'supply'
      ? FN.deposit
      : action === 'withdraw'
        ? FN.withdrawLending
        : action === 'borrow'
          ? FN.borrow
          : FN.repay;

  const sent = await sendAndWait(chainId, {
    from: account,
    to: pool,
    data: selector + encodeAddress(asset) + word(amount) + encodeAddress(account),
  });
  return { approveTx, tx: sent.hash, status: sent.status };
}
