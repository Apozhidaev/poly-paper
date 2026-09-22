import type { z } from "zod";

import { settings } from "../settings.js";
import type { PaperOrderDocument, PaperTradeDocument } from "../storage/index.js";
import type { Millis } from "../types.js";
import type { clobOrderReply, clobTradeReply } from "./schema.js";

/** Decimal amounts stay strings so clients that `Number(...)` them keep working. */
function amount(value: number): string {
  return String(value);
}

/** Gateway timestamps are ISO-8601; paper stores milliseconds. */
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

/**
 * Paper fills are always our own. Instant book crosses are TAKER; resting fills from the
 * public trade stream are MAKER. `makerOrders` stays empty — we do not model the counterparty.
 */
export function toClobTrade(trade: PaperTradeDocument): z.infer<typeof clobTradeReply> {
  const { apiKey, makerAddress } = settings().polymarket;
  const matchedAt = toIso(trade.match_time);
  return {
    id: trade.trade_id,
    outcome: trade.outcome ?? "",
    owner: apiKey,
    price: amount(trade.avg_price),
    side: trade.side,
    size: amount(trade.matched_amount),
    status: "TRADE_STATUS_CONFIRMED",
    conditionId: trade.condition_id,
    assetId: trade.asset_id,
    tokenId: trade.asset_id,
    bucketIndex: 0,
    feeRateBps: "0",
    updatedAt: matchedAt,
    makerAddress,
    makerOrders: [],
    matchedAt,
    takerOrderId: (trade.trader_side ?? "TAKER") === "TAKER" ? trade.order_id : "",
    traderSide: trade.trader_side ?? "TAKER",
    transactionHash: "",
  };
}
