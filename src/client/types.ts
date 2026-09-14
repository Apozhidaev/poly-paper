import type { Millis, Side } from "../types.js";

export const Tag = {
  M15: "102467",
  H1: "102175",
  M5: "102892",
  Bitcoin: "235",
  Ethereum: "39",
} as const;

export type Tag = (typeof Tag)[keyof typeof Tag];

export type OrderStatus =
  | "LIVE"
  | "MATCHED"
  | "CANCELED"
  | "CANCELED_MARKET_RESOLVED"
  | "INVALID";

export interface OptionPrices {
  openPrice: number;
  closePrice: number;
  timestamp: Millis;
  completed: boolean;
  incomplete: boolean;
  cached: boolean;
}

export interface UserTrade {
  tradeId: string;
  orderId: string;
  conditionId: string;
  assetId: string;
  avgPrice: number;
  matchedAmount: number;
  side: Side;
  matchTime: Millis;
}

/**
 * Order state as an `ExecutionPort` exposes it. Each implementation normalises the raw
 * payload, so `createdAt` is already in milliseconds regardless of what the source used.
 */
export interface ExecutionOrder {
  status: OrderStatus;
  price: number;
  originalSize: number;
  sizeMatched: number;
  createdAt: Millis;
  associateTrades: string[];
}

export interface LimitOrderResult {
  orderID?: string;
  success?: boolean;
}
