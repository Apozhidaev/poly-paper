import type { ObjectId } from "mongodb";

import type { Millis, OrderStatus, Side } from "../types.js";

export const COL_BALANCE = "balance";
export const COL_ORDER = "order";
export const COL_TRADE = "trade";
export const COL_MARKET = "market";
export const COL_TRADE_EVENT = "trade_event";

export const WALLET_ID = "paper_wallet";

/** Float dust tolerance for money and share comparisons. */
export const EPS = 1e-9;

export interface WalletDocument {
  _id: string;
  usdc_available: number;
  usdc_reserved: number;
  tokens: Record<string, number>;
  tokens_reserved: Record<string, number>;
}

export interface PaperOrderDocument {
  _id: string;
  asset_id: string;
  side: Side;
  price: number;
  original_size: number;
  size_matched: number;
  status: OrderStatus;
  created_at: Millis;
  associate_trades: string[];
  condition_id: string;
  /** Outcome label from the CLOB market (e.g. "Yes"); echoed in gateway order payloads. */
  outcome: string;
  /**
   * Newest trade event already accounted for by the matcher. Each order carries its own
   * cursor, so two orders on the same asset can both match against the same event stream.
   */
  cursor_event: ObjectId | null;
}

export interface PaperMarketDocument {
  _id: string;
  slug: string;
  assets_ids: string[];
  closed: boolean;
  winning_token_id?: string;
  closed_at?: Millis;
}

export interface PaperTradeDocument {
  trade_id: string;
  order_id: string;
  asset_id: string;
  condition_id: string;
  avg_price: number;
  matched_amount: number;
  side: Side;
  match_time: Millis;
  /** Instant book crosses are TAKER; resting fills from public trades are MAKER. */
  trader_side: "TAKER" | "MAKER";
  /** Outcome label copied from the order at fill time. */
  outcome: string;
}

export interface PaperTradeEventDocument {
  _id?: ObjectId;
  condition_id: string;
  asset_id: string;
  price: number;
  size: number;
  side: Side;
  timestamp: Millis;
  transaction_hash: string;
}
