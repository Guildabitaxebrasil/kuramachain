/**
 * Staking (`KurStaking`) — pools, recompensas e APR.
 *
 * O APR é calculado com dados on-chain: `rewardRate` (por segundo) ÷
 * `totalStaked`, anualizado e multiplicado pela razão de preço
 * recompensa/stake. Sem preço on-chain dos dois tokens, o APR fica `null`.
 */
import type { StakingPool } from '../types/defi';
import { FN } from '../abi/selectors';
import { encodeAddress, encodeApprove, isZeroAddress, word } from '../abi/coders';
import { ethCall, readUint } from './rpc';
import { contractAddress } from '../contracts/registry';
import { getPrices, toNumber } from './prices';
import { loadTokenMeta } from './pools';
import { sendAndWait } from './tx';

const SECONDS_PER_YEAR = 31_536_000;

function wordsOf(hex: string): bigint[] {
  const body = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out: bigint[] = [];
  for (let i = 0; i + 64 <= body.length; i += 64) {
    out.push(BigInt('0x' + body.slice(i, i + 64)));
  }
  return out;
}

export async function loadStakingPools(
  chainId: number,
  account?: string | null,
): Promise<StakingPool[]> {
  const staking = contractAddress(chainId, 'staking');
  if (!staking) return [];

  const count = Number(await readUint(chainId, staking, FN.poolCount, 0, 15_000));
  if (!count) return [];

  const out: StakingPool[] = [];
  for (let pid = 0; pid < count; pid += 1) {
    try {
      const pidWord = word(pid);
      const [infoRaw, userRaw, pendingRaw] = await Promise.all([
        ethCall(chainId, staking, FN.poolInfo + pidWord, 10_000),
        account
          ? ethCall(chainId, staking, FN.userInfo + pidWord + encodeAddress(account), 5_000)
          : Promise.resolve('0x'),
        account
          ? ethCall(chainId, staking, FN.pendingReward + pidWord + encodeAddress(account), 5_000)
          : Promise.resolve('0x'),
      ]);

      const info = wordsOf(infoRaw);
      if (info.length < 7) continue;
      const stakingToken = '0x' + info[0].toString(16).padStart(40, '0').slice(-40);
      const rewardToken = '0x' + info[1].toString(16).padStart(40, '0').slice(-40);
      if (isZeroAddress(stakingToken)) continue;
      const rewardRate = info[2];
      const rewardEnd = Number(info[3]);
      const totalStaked = info[4];
      const rewardBudget = info[6];

      const [metaStake, metaReward, prices] = await Promise.all([
        loadTokenMeta(chainId, stakingToken),
        loadTokenMeta(chainId, rewardToken),
        getPrices(chainId, [stakingToken, rewardToken]),
      ]);

      const user = wordsOf(userRaw);
      const myStaked = user[0] ?? 0n;
      const myPending = pendingRaw && pendingRaw !== '0x' ? wordsOf(pendingRaw)[0] ?? 0n : 0n;

      const stakePrice = prices[stakingToken.toLowerCase()]?.usd ?? null;
      const rewardPrice = prices[rewardToken.toLowerCase()]?.usd ?? null;
      let aprPct: number | null = null;
      if (totalStaked > 0n && stakePrice !== null && rewardPrice !== null) {
        const stakedHuman = toNumber(totalStaked, metaStake.decimals);
        const rewardPerYear = toNumber(rewardRate, metaReward.decimals) * SECONDS_PER_YEAR;
        if (stakedHuman > 0) {
          aprPct = ((rewardPerYear * rewardPrice) / (stakedHuman * stakePrice)) * 100;
        }
      }

      out.push({
        pid,
        stakingToken: metaStake,
        rewardToken: metaReward,
        rewardRate,
        rewardEnd,
        totalStaked,
        rewardBudget,
        aprPct: aprPct !== null && Number.isFinite(aprPct) ? aprPct : null,
        distributedRatio: null,
        myStaked,
        myPending,
      });
    } catch {
      // pool ilegível (ex.: contrato trocado) — segue para o próximo
    }
  }
  return out;
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

export interface StakingActionResult {
  approveTx?: string;
  tx: string;
  status: 'confirmed' | 'failed' | 'pending';
}

export async function stakeTokens(
  chainId: number,
  account: string,
  pool: StakingPool,
  amount: bigint,
): Promise<StakingActionResult> {
  const staking = contractAddress(chainId, 'staking');
  if (!staking) throw new Error('KurStaking não configurado');
  if (amount <= 0n) throw new Error('Quantidade inválida');
  const approveTx = await approveIfNeeded(chainId, account, pool.stakingToken.address, staking, amount);
  const sent = await sendAndWait(chainId, {
    from: account,
    to: staking,
    data: FN.stake + word(pool.pid) + word(amount),
  });
  return { approveTx, tx: sent.hash, status: sent.status };
}

export async function unstakeTokens(
  chainId: number,
  account: string,
  pool: StakingPool,
  amount: bigint,
): Promise<StakingActionResult> {
  const staking = contractAddress(chainId, 'staking');
  if (!staking) throw new Error('KurStaking não configurado');
  if (amount <= 0n) throw new Error('Quantidade inválida');
  const sent = await sendAndWait(chainId, {
    from: account,
    to: staking,
    data: FN.withdrawStake + word(pool.pid) + word(amount),
  });
  return { tx: sent.hash, status: sent.status };
}

export async function claimRewards(
  chainId: number,
  account: string,
  pool: StakingPool,
): Promise<StakingActionResult> {
  const staking = contractAddress(chainId, 'staking');
  if (!staking) throw new Error('KurStaking não configurado');
  const sent = await sendAndWait(chainId, {
    from: account,
    to: staking,
    data: FN.claim + word(pool.pid),
  });
  return { tx: sent.hash, status: sent.status };
}

export async function emergencyUnstake(
  chainId: number,
  account: string,
  pool: StakingPool,
): Promise<StakingActionResult> {
  const staking = contractAddress(chainId, 'staking');
  if (!staking) throw new Error('KurStaking não configurado');
  const sent = await sendAndWait(chainId, {
    from: account,
    to: staking,
    data: FN.emergencyWithdraw + word(pool.pid),
  });
  return { tx: sent.hash, status: sent.status };
}
