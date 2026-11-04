/**
 * Oráculos da KuramaChain.
 *
 * Lê o `KurPriceFeed` (AggregatorV3 com mediana e quórum) e o `KurOracle`
 * (TWAP do par com fallback para o feed). Cada leitura traz fonte, timestamp e
 * frescor — a UI mostra “Dados indisponíveis” quando não há contrato.
 */
import type { OracleReading } from '../types/defi';
import { FN } from '../abi/selectors';
import { contractAddress } from '../contracts/registry';
import { decodeOptionalString } from '../abi/coders';
import { ethCall, readInt, readString, readUint } from './rpc';
import { toNumber } from './prices';

export interface OracleOverview {
  configured: boolean;
  feedConfigured: boolean;
  oracleConfigured: boolean;
  readings: OracleReading[];
  quorum: number | null;
  reporters: number | null;
  maxAge: number | null;
  period: number | null;
  twapReady: boolean | null;
  description: string | null;
  notes: string[];
}

const EMPTY: OracleOverview = {
  configured: false,
  feedConfigured: false,
  oracleConfigured: false,
  readings: [],
  quorum: null,
  reporters: null,
  maxAge: null,
  period: null,
  twapReady: null,
  description: null,
  notes: [],
};

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export async function loadOracleOverview(chainId: number): Promise<OracleOverview> {
  const feed = contractAddress(chainId, 'priceFeed');
  const oracle = contractAddress(chainId, 'oracle');
  if (!feed && !oracle) {
    return {
      ...EMPTY,
      notes: ['Nenhum oráculo configurado (KurPriceFeed / KurOracle) para esta rede.'],
    };
  }

  const readings: OracleReading[] = [];
  const notes: string[] = [];
  let quorum: number | null = null;
  let reporters: number | null = null;
  let maxAge: number | null = null;
  let period: number | null = null;
  let twapReady: boolean | null = null;
  let description: string | null = null;

  if (feed) {
    try {
      const [answer, updatedAt, decimals, descriptionRaw, quorumRaw, reportersRaw] = await Promise.all([
        readInt(chainId, feed, FN.latestRoundData, 1, 15_000),
        readUint(chainId, feed, FN.latestRoundData, 3, 15_000),
        readUint(chainId, feed, FN.decimals, 0, 60_000),
        ethCall(chainId, feed, FN.description, 60_000),
        readUint(chainId, feed, FN.quorum, 0, 60_000).catch(() => null),
        readUint(chainId, feed, FN.reportersLength, 0, 60_000).catch(() => null),
      ]);
      const dec = Number(decimals);
      description = decodeOptionalString(descriptionRaw);
      quorum = quorumRaw === null ? null : Number(quorumRaw);
      reporters = reportersRaw === null ? null : Number(reportersRaw);
      const price = answer > 0n ? toNumber(answer, dec) : null;
      const age = updatedAt > 0n ? nowSeconds() - Number(updatedAt) : null;
      readings.push({
        label: 'KurPriceFeed (mediana)',
        price,
        decimals: dec,
        source: description || 'AggregatorV3',
        updatedAt: Number(updatedAt) || null,
        fresh: age === null ? null : age >= 0 && age <= 3600,
        extra: age === null ? 'sem rodada publicada' : `atualizado há ${Math.max(0, age)}s`,
      });
    } catch {
      notes.push('Falha ao ler o KurPriceFeed (contrato sem dados ou endereço errado).');
    }
  }

  if (oracle) {
    try {
      const [priceRaw, feedPriceRaw, feedStampRaw, freshRaw, twapRaw, maxAgeRaw, periodRaw] =
        await Promise.all([
          ethCall(chainId, oracle, FN.getPrice),
          ethCall(chainId, oracle, FN.feedPrice),
          ethCall(chainId, oracle, FN.feedPrice),
          ethCall(chainId, oracle, FN.feedPrice),
          ethCall(chainId, oracle, FN.twapReady, 30_000),
          readUint(chainId, oracle, FN.maxAge, 0, 60_000),
          readUint(chainId, oracle, FN.period, 0, 60_000),
        ]);

      const priceWord = priceRaw && priceRaw !== '0x' ? BigInt('0x' + priceRaw.slice(2, 66)) : 0n;
      const fromFeedWord =
        priceRaw && priceRaw.length >= 130 ? BigInt('0x' + priceRaw.slice(66, 130)) : 0n;
      const feedPriceWord =
        feedPriceRaw && feedPriceRaw !== '0x' ? BigInt('0x' + feedPriceRaw.slice(2, 66)) : 0n;
      const stampWord =
        feedStampRaw && feedStampRaw.length >= 130
          ? BigInt('0x' + feedStampRaw.slice(66, 130))
          : 0n;
      const freshWord =
        freshRaw && freshRaw.length >= 194 ? BigInt('0x' + freshRaw.slice(130, 194)) : 0n;

      twapReady = twapRaw && twapRaw !== '0x' ? BigInt(twapRaw) === 1n : null;
      maxAge = Number(maxAgeRaw);
      period = Number(periodRaw);

      readings.push({
        label: 'KurOracle getPrice() (token0/token1)',
        price: priceWord > 0n ? toNumber(priceWord, 8) : null,
        decimals: 8,
        source: fromFeedWord === 1n ? 'fallback: feed' : 'fallback: TWAP do par',
        updatedAt: null,
        fresh: twapReady,
        extra: twapReady === false ? 'TWAP ainda não tem janela suficiente' : undefined,
      });

      readings.push({
        label: 'KurOracle feedPrice()',
        price: feedPriceWord > 0n ? toNumber(feedPriceWord, 8) : null,
        decimals: 8,
        source: 'feed do oráculo',
        updatedAt: Number(stampWord) || null,
        fresh: freshWord === 1n,
      });
    } catch {
      notes.push('Falha ao ler o KurOracle (TWAP pode não estar pronto).');
    }
  }

  const priced = readings.filter((reading) => reading.price !== null);
  if (priced.length >= 2) {
    const values = priced.map((reading) => reading.price as number);
    const max = Math.max(...values);
    if (max > 0) {
      const divergenceBps = ((max - Math.min(...values)) / max) * 10_000;
      if (divergenceBps > 100) {
        notes.push(`Divergência de ${(divergenceBps / 100).toFixed(2)}% entre as fontes.`);
      }
    }
  }

  return {
    configured: true,
    feedConfigured: !!feed,
    oracleConfigured: !!oracle,
    readings,
    quorum,
    reporters,
    maxAge,
    period,
    twapReady,
    description,
    notes,
  };
}

export async function readFeedPairDescription(chainId: number): Promise<string | null> {
  const feed = contractAddress(chainId, 'priceFeed');
  if (!feed) return null;
  try {
    return (await readString(chainId, feed, FN.description, 60_000)) || null;
  } catch {
    return null;
  }
}
