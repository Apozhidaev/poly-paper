export type Side = "BUY" | "SELL";

/** Unix time in milliseconds. Every timestamp in this codebase uses this unit. */
export type Millis = number;

export function nowMs(): Millis {
  return Date.now();
}

/** The gateway reports order and trade times in seconds; normalise them at the parsing boundary. */
export function secToMs(seconds: number): Millis {
  return seconds * 1000;
}

export interface BookOrder {
  price: number;
  quantity: number;
}

export interface Depth extends BookOrder {
  totQty: number;
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

export interface TickInfo {
  conditionId: string;
  slug: string;
  negRisk: boolean;
  tickSize: number;
  minOrderSize: number;
  orderbooks: OrderBook[];
}

export interface PlaceOrderParams {
  dealId: number;
  assetId: string;
  side: Side;
  price: number;
  size: number;
  tickSize: number;
  negRisk: boolean;
}
