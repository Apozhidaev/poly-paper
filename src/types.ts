export type Side = "BUY" | "SELL";

/** Unix time in milliseconds. Every timestamp in this codebase uses this unit. */
export type Millis = number;

export function nowMs(): Millis {
  return Date.now();
}

/** The CLOB reports order and trade times in seconds; normalise them at the parsing boundary. */
export function secToMs(seconds: number): Millis {
  return seconds * 1000;
}

/** Inverse of `secToMs`, used when rendering CLOB-shaped responses. */
export function msToSec(ms: Millis): number {
  return Math.floor(ms / 1000);
}

export type OrderStatus =
  | "LIVE"
  | "MATCHED"
  | "CANCELED"
  | "CANCELED_MARKET_RESOLVED"
  | "INVALID";

export interface BookOrder {
  price: number;
  quantity: number;
}

export interface OrderBook {
  assetId: string;
  conditionId: string;
  timestamp: Millis;
  asks: BookOrder[];
  bids: BookOrder[];
  minOrderSize: number;
  tickSize: number;
  negRisk: boolean;
}
