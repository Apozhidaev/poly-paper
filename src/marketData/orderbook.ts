import type { BookOrder, OrderBook } from "../types.js";
import { polyGate } from "./polyGate.js";

interface RawLevel {
  price: number | string;
  size: number | string;
}

function levels(raw: unknown): BookOrder[] {
  if (!Array.isArray(raw)) return [];
  return (raw as RawLevel[]).map((x) => ({
    price: Number(x.price),
    quantity: Number(x.size),
  }));
}

export function parseOrderbook(orderbook: Record<string, unknown>): OrderBook {
  return {
    assetId: orderbook["asset_id"] as string,
    conditionId: (orderbook["market"] as string | undefined) ?? "",
    asks: levels(orderbook["asks"]).reverse(),
    bids: levels(orderbook["bids"]).reverse(),
    timestamp: Number(orderbook["timestamp"]),
    minOrderSize: Number(orderbook["min_order_size"]),
    tickSize: Number(orderbook["tick_size"]),
    negRisk: orderbook["neg_risk"] as boolean,
  };
}

export async function getOrderbook(tokenId: string): Promise<OrderBook | null> {
  const raw = await polyGate.orderBook(tokenId);
  if (raw === null) return null;
  return parseOrderbook(raw);
}

/** API limit on the number of token_ids per order-books request. */
const MAX_ORDERBOOKS_BATCH = 500;

/** Books keyed by asset_id; missing ones are simply absent from the map. */
export async function getOrderbooksMap(tokenIds: string[]): Promise<Map<string, OrderBook>> {
  const result = new Map<string, OrderBook>();
  if (tokenIds.length === 0) return result;
  for (let i = 0; i < tokenIds.length; i += MAX_ORDERBOOKS_BATCH) {
    const batch = tokenIds.slice(i, i + MAX_ORDERBOOKS_BATCH);
    const rawOrderbooks = await polyGate.orderBooks(batch);
    for (const raw of rawOrderbooks) {
      const orderbook = parseOrderbook(raw);
      result.set(orderbook.assetId, orderbook);
    }
  }
  return result;
}
