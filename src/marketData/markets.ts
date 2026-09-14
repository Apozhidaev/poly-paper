import { z } from "zod";

import type { Millis } from "../types.js";
import { polyGate } from "./polyGate.js";

const EPOCH: Millis = 0;

function isoToMs(value: string): Millis {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`invalid ISO timestamp: ${value}`);
  return parsed;
}

function toMs(value: number | string | null | undefined): Millis {
  if (value === null || value === undefined || value === "") return EPOCH;
  if (typeof value === "number") return value;
  return isoToMs(value);
}

function toOptionalMs(value: number | string | null | undefined): Millis | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;
  return isoToMs(value);
}

const dateLike = z.union([z.number(), z.string(), z.null()]).optional();

const tokenSchema = z.object({
  token_id: z.string(),
  outcome: z.string(),
  price: z.coerce.number(),
  winner: z.coerce.boolean(),
});

/** Single market from the Polymarket CLOB API (`GET /markets/{condition_id}`). */
const marketSchema = z.object({
  enable_order_book: z.coerce.boolean(),
  active: z.coerce.boolean(),
  closed: z.coerce.boolean(),
  archived: z.coerce.boolean(),
  accepting_orders: z.coerce.boolean(),
  accepting_order_timestamp: dateLike,
  minimum_order_size: z.coerce.number(),
  minimum_tick_size: z.coerce.number(),
  condition_id: z.string(),
  question_id: z.string(),
  question: z.string(),
  description: z.string(),
  market_slug: z.string(),
  end_date_iso: dateLike,
  game_start_time: dateLike,
  seconds_delay: z.coerce.number(),
  fpmm: z.string(),
  maker_base_fee: z.coerce.number(),
  taker_base_fee: z.coerce.number(),
  notifications_enabled: z.coerce.boolean(),
  neg_risk: z.coerce.boolean(),
  neg_risk_market_id: z.string(),
  neg_risk_request_id: z.string(),
  is_50_50_outcome: z.coerce.boolean(),
  tokens: z.array(tokenSchema),
  tags: z.array(z.string()),
});

export interface ClobMarketToken {
  tokenId: string;
  outcome: string;
  price: number;
  winner: boolean;
}

export interface ClobMarket {
  enableOrderBook: boolean;
  active: boolean;
  closed: boolean;
  archived: boolean;
  acceptingOrders: boolean;
  acceptingOrderTimestamp: Millis | null;
  minimumOrderSize: number;
  minimumTickSize: number;
  conditionId: string;
  questionId: string;
  question: string;
  description: string;
  marketSlug: string;
  endTime: Millis;
  gameStartTime: Millis | null;
  secondsDelay: number;
  fpmm: string;
  makerBaseFee: number;
  takerBaseFee: number;
  notificationsEnabled: boolean;
  negRisk: boolean;
  negRiskMarketId: string;
  negRiskRequestId: string;
  is5050Outcome: boolean;
  tokens: ClobMarketToken[];
  tags: string[];
  enableTrading: boolean;
  hasWinner: boolean;
  winningTokenId: string | null;
}

export function parseMarket(data: unknown): ClobMarket {
  const raw = marketSchema.parse(data);
  const tokens: ClobMarketToken[] = raw.tokens.map((t) => ({
    tokenId: t.token_id,
    outcome: t.outcome,
    price: t.price,
    winner: t.winner,
  }));
  return {
    enableOrderBook: raw.enable_order_book,
    active: raw.active,
    closed: raw.closed,
    archived: raw.archived,
    acceptingOrders: raw.accepting_orders,
    acceptingOrderTimestamp: toOptionalMs(raw.accepting_order_timestamp),
    minimumOrderSize: raw.minimum_order_size,
    minimumTickSize: raw.minimum_tick_size,
    conditionId: raw.condition_id,
    questionId: raw.question_id,
    question: raw.question,
    description: raw.description,
    marketSlug: raw.market_slug,
    endTime: toMs(raw.end_date_iso),
    gameStartTime: toOptionalMs(raw.game_start_time),
    secondsDelay: raw.seconds_delay,
    fpmm: raw.fpmm,
    makerBaseFee: raw.maker_base_fee,
    takerBaseFee: raw.taker_base_fee,
    notificationsEnabled: raw.notifications_enabled,
    negRisk: raw.neg_risk,
    negRiskMarketId: raw.neg_risk_market_id,
    negRiskRequestId: raw.neg_risk_request_id,
    is5050Outcome: raw.is_50_50_outcome,
    tokens,
    tags: raw.tags,
    enableTrading: raw.accepting_orders && !raw.closed && raw.active && raw.enable_order_book,
    hasWinner: tokens.some((t) => t.winner),
    winningTokenId: tokens.find((t) => t.winner)?.tokenId ?? null,
  };
}

/** Fetch one market from CLOB by `condition_id`. Returns null if not found (404). */
export async function getMarketByConditionId(conditionId: string): Promise<ClobMarket | null> {
  const data = await polyGate.market(conditionId);
  if (data === null) return null;
  return parseMarket(data);
}
