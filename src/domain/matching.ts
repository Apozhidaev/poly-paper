import type { OrderBook, Side } from "../types.js";
import { roundShares } from "./money.js";

/** Only the fields the matcher needs, so the domain stays free of storage types. */
export interface TradeEventLike {
  price: number;
  size: number;
}

/**
 * A resting order is considered hit once the market trades *through* its price: below the
 * limit for a BUY, above it for a SELL. Trades exactly at the limit are not counted — they
 * could have been filled by someone else's order sitting ahead in the queue.
 */
export function tradedThrough(side: Side, limitPrice: number, eventPrice: number): boolean {
  return side === "BUY" ? eventPrice < limitPrice : eventPrice > limitPrice;
}

export interface MakerMatchInput {
  side: Side;
  limitPrice: number;
  /** Unfilled part of the order. */
  remaining: number;
  events: TradeEventLike[];
}

export interface MakerMatch {
  fillQty: number;
}

/**
 * Volume of qualifying opposite-side trades, capped by what is left of the order. The caller
 * consumes the whole batch either way: events that failed to qualify never will, because the
 * limit price does not change.
 */
export function matchFromTradeEvents({
  side,
  limitPrice,
  remaining,
  events,
}: MakerMatchInput): MakerMatch {
  let volume = 0;
  for (const event of events) {
    if (!tradedThrough(side, limitPrice, event.price)) continue;
    volume += event.size;
    if (volume >= remaining) break;
  }
  return { fillQty: roundShares(Math.min(volume, remaining)) };
}

export interface TakerFill {
  price: number;
  qty: number;
}

export interface TakerMatchInput {
  side: Side;
  limitPrice: number;
  size: number;
  orderbook: OrderBook;
}

/**
 * Immediate execution against the resting book, level by level, capped by displayed depth.
 * `asks` are ascending and `bids` descending (see `parseOrderbook`), so the best price comes
 * first for either side. The unfilled remainder stays as a resting order.
 */
export function matchTaker({
  side,
  limitPrice,
  size,
  orderbook,
}: TakerMatchInput): TakerFill[] {
  const levels = side === "BUY" ? orderbook.asks : orderbook.bids;
  const crosses = (price: number): boolean =>
    side === "BUY" ? price <= limitPrice : price >= limitPrice;

  const fills: TakerFill[] = [];
  let remaining = size;
  for (const level of levels) {
    if (remaining <= 0) break;
    if (!crosses(level.price)) break;
    const qty = roundShares(Math.min(remaining, level.quantity));
    if (qty <= 0) continue;
    fills.push({ price: level.price, qty });
    remaining = roundShares(remaining - qty);
  }
  return fills;
}
