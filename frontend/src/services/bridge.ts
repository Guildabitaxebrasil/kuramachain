/**
 * Bridge (`KurBridge`) — estado, rotas registradas e depósitos.
 *
 * O bridge é lock/mint com atestação m-de-n. A interface **não simula** uma
 * ponte que não existe: só lista destinos cujo `wrappedFor(destChain, token)`
 * está registrado on-chain. Sem contrato configurado, tudo aparece como
 * “não configurado”.
 */
import { EVT, FN } from '../abi/selectors';
import {
  encodeAddress,
  encodeApprove,
  encodeDepositBridge,
  isZeroAddress,
  word,
} from '../abi/coders';
import { ethCall, getBlockNumber, readAddress, readUint, rpc } from './rpc';
import { contractAddress } from '../contracts/registry';
import { CHAINS, KURAMA_CHAIN_ID } from '../chains/chains';
import { blocksForHours } from './pools';
import { sendAndWait } from './tx';

export interface BridgeDestination {
  chainId: number;
  name: string;
  /** Wrapped registrado on-chain para o token escolhido (ou `null`). */
  wrappedToken: string | null;
  enabled: boolean;
}

export interface BridgeState {
  configured: boolean;
  paused: boolean | null;
  threshold: number | null;
  validators: number | null;
  localChainId: number | null;
  nonce: number | null;
  destinations: BridgeDestination[];
}

const EMPTY_STATE: BridgeState = {
  configured: false,
  paused: null,
  threshold: null,
  validators: null,
  localChainId: null,
  nonce: null,
  destinations: [],
};

export async function loadBridgeState(chainId: number, token?: string): Promise<BridgeState> {
  const bridge = contractAddress(chainId, 'bridge');
  if (!bridge) return EMPTY_STATE;

  const [paused, threshold, validators, localChainId, nonce] = await Promise.all([
    readUint(chainId, bridge, FN.paused, 0, 30_000).catch(() => null),
    readUint(chainId, bridge, FN.threshold, 0, 30_000).catch(() => null),
    readUint(chainId, bridge, FN.validatorsLength, 0, 30_000).catch(() => null),
    readUint(chainId, bridge, FN.localChainId, 0, 30_000).catch(() => null),
    readUint(chainId, bridge, FN.nonce, 0, 10_000).catch(() => null),
  ]);

  const destinations: BridgeDestination[] = [];
  if (token) {
    for (const chain of CHAINS) {
      if (chain.id === chainId) continue;
      let wrappedToken: string | null = null;
      try {
        const address = await readAddress(
          chainId,
          bridge,
          FN.wrappedFor + word(chain.id) + encodeAddress(token),
          20_000,
        );
        wrappedToken = isZeroAddress(address) ? null : address;
      } catch {
        wrappedToken = null;
      }
      destinations.push({
        chainId: chain.id,
        name: chain.name,
        wrappedToken,
        enabled: !!wrappedToken,
      });
    }
  }

  return {
    configured: true,
    paused: paused === null ? null : paused === 1n,
    threshold: threshold === null ? null : Number(threshold),
    validators: validators === null ? null : Number(validators),
    localChainId: localChainId === null ? null : Number(localChainId),
    nonce: nonce === null ? null : Number(nonce),
    destinations,
  };
}

export interface BridgeResult {
  approveTx?: string;
  tx: string;
  status: 'confirmed' | 'failed' | 'pending';
}

export async function bridgeDeposit(
  chainId: number,
  account: string,
  token: string,
  amount: bigint,
  destChain: number,
  recipient: string,
): Promise<BridgeResult> {
  const bridge = contractAddress(chainId, 'bridge');
  if (!bridge) throw new Error('KurBridge não configurado');
  if (chainId === destChain) throw new Error('Origem e destino são a mesma chain');
  if (amount <= 0n) throw new Error('Quantidade inválida');

  const allowance = await readUint(
    chainId,
    token,
    FN.allowance + encodeAddress(account) + encodeAddress(bridge),
    0,
    2_000,
  );
  let approveTx: string | undefined;
  if (allowance < amount) {
    const sent = await sendAndWait(chainId, {
      from: account,
      to: token,
      data: encodeApprove(bridge, amount),
    });
    if (sent.status === 'failed') throw new Error('A aprovação do token falhou');
    approveTx = sent.hash;
  }

  const sent = await sendAndWait(chainId, {
    from: account,
    to: bridge,
    data: encodeDepositBridge(token, amount, destChain, recipient),
  });
  return { approveTx, tx: sent.hash, status: sent.status };
}

export interface BridgeDepositRecord {
  depositId: string;
  token: string;
  sender: string;
  amount: bigint;
  destChain: number;
  recipient: string;
  nonce: number;
  txHash: string;
  blockNumber: number;
}

interface RawLog {
  data: string;
  topics: string[];
  blockNumber: string;
  transactionHash: string;
}

export async function loadBridgeDeposits(
  chainId: number,
  hours = 24 * 7,
): Promise<BridgeDepositRecord[]> {
  const bridge = contractAddress(chainId, 'bridge');
  if (!bridge) return [];
  const latest = await getBlockNumber(chainId);
  const fromBlock = Math.max(0, latest - blocksForHours(chainId, hours));
  let logs: RawLog[] = [];
  try {
    logs = await rpc<RawLog[]>(
      chainId,
      'eth_getLogs',
      [
        {
          address: bridge,
          topics: [EVT.BridgeDeposit],
          fromBlock: `0x${fromBlock.toString(16)}`,
          toBlock: 'latest',
        },
      ],
      { timeoutMs: 25_000 },
    );
  } catch {
    return [];
  }
  if (!Array.isArray(logs)) return [];

  return logs
    .map((log): BridgeDepositRecord | null => {
      try {
        const body = log.data.startsWith('0x') ? log.data.slice(2) : log.data;
        const wordAt = (index: number) => BigInt('0x' + body.slice(index * 64, index * 64 + 64));
        const addressWord = (value: bigint) => '0x' + value.toString(16).padStart(40, '0').slice(-40);
        return {
          depositId: log.topics[1] ?? '',
          token: '0x' + (log.topics[2] ?? '').slice(-40),
          sender: '0x' + (log.topics[3] ?? '').slice(-40),
          amount: wordAt(0),
          destChain: Number(wordAt(1)),
          recipient: addressWord(wordAt(2)),
          nonce: Number(wordAt(3)),
          txHash: log.transactionHash,
          blockNumber: Number.parseInt(log.blockNumber, 16),
        };
      } catch {
        return null;
      }
    })
    .filter((record): record is BridgeDepositRecord => record !== null)
    .sort((a, b) => b.blockNumber - a.blockNumber);
}

/** Nome da chain de destino (para exibição). */
export function destinationName(chainId: number): string {
  return CHAINS.find((chain) => chain.id === chainId)?.name ?? `Chain ${chainId}`;
}

/** O bridge só fala com a própria KuramaChain na UI atual. */
export const BRIDGE_SOURCE_CHAIN = KURAMA_CHAIN_ID;
