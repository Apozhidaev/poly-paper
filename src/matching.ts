import type { OrderBook, Side } from "./types";
import type { PaperTradeEventDocument } from "./storage.js";

export interface TradeEventMatchInput {
  side: Side;
  limitPrice: number;
  orderSize: number;
  events: PaperTradeEventDocument[];
}

/**
 * Sums the volume of opposite-side trade events in timestamp order. Note that several LIVE
 * orders on the same asset_id can match against the very same events.
 */
export function tryMatchTradeEvents({
  side,
  limitPrice,
  orderSize,
  events,
}: TradeEventMatchInput): boolean {
  let total = 0;
  for (const event of events) {
    const price = event.price;
    if (side === "BUY") {
      if (price >= limitPrice) continue;
    } else if (side === "SELL") {
      if (price <= limitPrice) continue;
    } else {
      return false;
    }
    total += event.size;
    if (total >= orderSize) return true;
  }
  return false;
}

export interface OneLevelMatchInput {
  side: Side;
  limitPrice: number;
  orderbook: OrderBook;
}

/**
 * Crosses the limit against the best ask/bid by price and fills the whole limit at that
 * level. Book depth (quantity) is not taken into account.
 */
export function tryMatchOneLevel({ side, limitPrice, orderbook }: OneLevelMatchInput): boolean {
  if (side === "BUY") {
    if (orderbook.asks.length === 0) return false;
    return orderbook.asks[0].price <= limitPrice;
  }
  if (side === "SELL") {
    if (orderbook.bids.length === 0) return false;
    return orderbook.bids[0].price >= limitPrice;
  }
  return false;
}
