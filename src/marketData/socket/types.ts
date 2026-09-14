import type { Millis, Side } from "../../types.js";

export type MarketEventType = "BOOK" | "TRADE" | "BOOK_CHANGE";

export interface TradeEvent {
  conditionId: string;
  assetId: string;
  price: number;
  size: number;
  side: Side;
  timestamp: Millis;
  transactionHash: string;
}

export interface PriceChange {
  assetId: string;
  price: number;
  size: number;
  side: Side;
  bestBid: number;
  bestAsk: number;
}

export interface BookChangeEvent {
  conditionId: string;
  timestamp: Millis;
  priceChanges: PriceChange[];
}
