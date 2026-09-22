import { collection } from "../mongo.js";
import type { Millis } from "../types.js";
import { COL_TRADE, type PaperTradeDocument } from "./types.js";

const trades = () => collection<PaperTradeDocument>(COL_TRADE);

export async function insertTrade(doc: PaperTradeDocument): Promise<void> {
  await trades().insertOne(doc);
}

export async function findTradeById(tradeId: string): Promise<PaperTradeDocument | null> {
  return trades().findOne({ trade_id: tradeId });
}

export async function findTradesByOrderId(orderId: string): Promise<PaperTradeDocument[]> {
  return trades().find({ order_id: orderId }).sort({ match_time: 1 }).toArray();
}

export interface TradeFilter {
  tradeId?: string;
  conditionId?: string;
  assetId?: string;
  /** Inclusive lower bound on `match_time`. */
  afterMs?: Millis;
  /** Exclusive upper bound on `match_time`. */
  beforeMs?: Millis;
  limit?: number;
}

export async function findTrades(filter: TradeFilter = {}): Promise<PaperTradeDocument[]> {
  const query: Record<string, unknown> = {};
  if (filter.tradeId !== undefined) query["trade_id"] = filter.tradeId;
  if (filter.conditionId !== undefined) query["condition_id"] = filter.conditionId;
  if (filter.assetId !== undefined) query["asset_id"] = filter.assetId;
  if (filter.afterMs !== undefined || filter.beforeMs !== undefined) {
    const range: Record<string, Millis> = {};
    if (filter.afterMs !== undefined) range["$gte"] = filter.afterMs;
    if (filter.beforeMs !== undefined) range["$lt"] = filter.beforeMs;
    query["match_time"] = range;
  }
  return trades()
    .find(query)
    .sort({ match_time: -1 })
    .limit(filter.limit ?? 200)
    .toArray();
}
