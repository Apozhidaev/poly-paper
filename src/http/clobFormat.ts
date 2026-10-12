import type { z } from "zod";

import { settings } from "../settings.js";
import type { PaperOrderDocument, PaperTradeDocument } from "../storage/index.js";
import type { Millis } from "../types.js";
import type { clobOrderReply, clobTradeReply } from "./schema.js";

/** Decimal amounts stay strings so clients that `Number(...)` them keep working. */
function amount(value: number): string {
  return String(value);
}

/** Gateway order timestamps are ISO-8601; paper stores milliseconds. */
function toIso(ms: Millis): string {
  return new Date(ms).toISOString();
}

export function toClobOrder(order: PaperOrderDocument): z.infer<typeof clobOrderReply> {
  const { apiKey, makerAddress } = settings().polymarket;
  return {
    id: order._id,
    outcome: order.outcome ?? "",
    owner: apiKey,
    price: amount(order.price),
    side: order.side,
    status: order.status,
    conditionId: order.condition_id,
    assetId: order.asset_id,
    tokenId: order.asset_id,
    associateTrades: order.associate_trades,
    createdAt: toIso(order.created_at),
    makerAddress,
    orderType: "GTC",
    originalSize: amount(order.original_size),
    sizeMatched: amount(order.size_matched),
  };
}

/** Poly-gate maps CLOB trades into this compact UserTrade row before returning them. */
export function toClobTrade(trade: PaperTradeDocument): z.infer<typeof clobTradeReply> {
  return {
    tradeId: trade.trade_id,
    orderId: trade.order_id,
    conditionId: trade.condition_id,
    assetId: trade.asset_id,
    avgPrice: trade.avg_price,
    matchedAmount: trade.matched_amount,
    side: trade.side,
    matchTime: trade.match_time,
  };
}
