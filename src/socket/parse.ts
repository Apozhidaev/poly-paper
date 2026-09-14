import type { Side } from "../../types.js";
import type { BookChangeEvent, PriceChange, TradeEvent } from "./types.js";

type Json = Record<string, unknown>;

export function parseTrade(event: Json): TradeEvent {
  return {
    conditionId: event["market"] as string,
    assetId: event["asset_id"] as string,
    price: Number(event["price"]),
    size: Number(event["size"]),
    side: event["side"] as Side,
    timestamp: Number(event["timestamp"]),
    transactionHash: (event["transaction_hash"] as string | undefined) ?? "",
  };
}

export function parsePriceChange(event: Json): PriceChange {
  return {
    assetId: event["asset_id"] as string,
    price: Number(event["price"]),
    size: Number(event["size"]),
    side: event["side"] as Side,
    bestBid: Number(event["best_bid"]),
    bestAsk: Number(event["best_ask"]),
  };
}

export function parseBookChange(event: Json): BookChangeEvent {
  const priceChanges = event["price_changes"];
  return {
    conditionId: event["market"] as string,
    priceChanges: Array.isArray(priceChanges)
      ? (priceChanges as Json[]).map(parsePriceChange)
      : [],
    timestamp: Number(event["timestamp"]),
  };
}
