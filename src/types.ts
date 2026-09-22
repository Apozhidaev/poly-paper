export type Side = "BUY" | "SELL";

/** Unix time in milliseconds. Every timestamp in this codebase uses this unit. */
export type Millis = number;

export function nowMs(): Millis {
  return Date.now();
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
