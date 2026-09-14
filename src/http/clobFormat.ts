import type { z } from "zod";

import { settings } from "../settings.js";
import type { PaperOrderDocument, PaperTradeDocument } from "../storage/index.js";
import { msToSec } from "../types.js";
import type { clobOrderReply, clobTradeReply } from "./schema.js";

/**
 * The CLOB quotes money and share amounts as decimal strings and timestamps in seconds. Both
 * conventions are reproduced here so a client written against the real gateway needs no
 * special casing — the robot's parsers already do `Number(...)` and `secToMs(...)`.
 */
function amount(value: number): string {
  return String(value);
}

export function toClobOrder(order: PaperOrderDocument): z.infer<typeof clobOrderReply> {
  return {
    id: order._id,
    status: order.status,
    market: order.condition_id,
    asset_id: order.asset_id,
    side: order.side,
    price: amount(order.price),
    original_size: amount(order.original_size),
    size_matched: amount(order.size_matched),
    created_at: msToSec(order.created_at),
    associate_trades: order.associate_trades,
    type: "GTC",
    owner: settings().polymarket.apiKey,
  };
}

/**
 * Paper orders are always our own, so a trade is rendered in the taker shape with an empty
 * `maker_orders`. `owner` echoes the configured API key because the robot keeps only trades
 * whose owner matches its own `polymarket.api_key`.
 */
export function toClobTrade(trade: PaperTradeDocument): z.infer<typeof clobTradeReply> {
  return {
    id: trade.trade_id,
    taker_order_id: trade.order_id,
    market: trade.condition_id,
    asset_id: trade.asset_id,
    side: trade.side,
    price: amount(trade.avg_price),
    size: amount(trade.matched_amount),
    status: "CONFIRMED",
    match_time: msToSec(trade.match_time),
    owner: settings().polymarket.apiKey,
    maker_orders: [],
  };
}
