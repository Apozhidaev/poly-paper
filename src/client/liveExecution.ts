import { getOr } from "../config.js";
import { getLogger } from "../logging.js";
import { secToMs, type Side } from "../types.js";
import { polyGate } from "./polyGate.js";
import { clobTickSizeStr } from "./tickSize.js";
import type { ExecutionOrder, LimitOrderResult, OrderStatus, UserTrade } from "./types.js";
import type { ExecutionPort, LimitOrderInput } from "./execution.js";

const logger = getLogger();
const polyApiKey = getOr("polymarket.api_key", "");

type Json = Record<string, unknown>;

function cancelSucceeded(resp: unknown, orderId: string): boolean {
  if (typeof resp !== "object" || resp === null) return false;
  const body = resp as Json;
  const canceled = body["canceled"];
  if (Array.isArray(canceled) && canceled.includes(orderId)) return true;
  const alt = body["canceledIds"];
  if (Array.isArray(alt) && alt.includes(orderId)) return true;
  return body["success"] === true;
}

/** The gateway reports `created_at` in seconds; everything downstream works in milliseconds. */
function parseOrder(raw: Json): ExecutionOrder {
  const associateTrades = raw["associate_trades"];
  return {
    status: (raw["status"] as OrderStatus | undefined) ?? "INVALID",
    price: Number(raw["price"] ?? 0),
    originalSize: Number(raw["original_size"] ?? 0),
    sizeMatched: Number(raw["size_matched"] ?? 0),
    createdAt: secToMs(Number(raw["created_at"] ?? 0)),
    associateTrades: Array.isArray(associateTrades) ? (associateTrades as string[]) : [],
  };
}

function parseTaker(trade: Json): UserTrade {
  return {
    tradeId: trade["id"] as string,
    orderId: trade["taker_order_id"] as string,
    assetId: trade["asset_id"] as string,
    conditionId: trade["market"] as string,
    avgPrice: Number(trade["price"]),
    matchedAmount: Number(trade["size"]),
    side: trade["side"] as Side,
    matchTime: secToMs(Number(trade["match_time"])),
  };
}

function parseMaker(order: Json, trade: Json): UserTrade {
  return {
    tradeId: trade["id"] as string,
    orderId: order["order_id"] as string,
    assetId: order["asset_id"] as string,
    conditionId: trade["market"] as string,
    avgPrice: Number(order["price"]),
    matchedAmount: Number(order["matched_amount"]),
    side: order["side"] as Side,
    matchTime: secToMs(Number(trade["match_time"])),
  };
}

function parseMakers(trade: Json): UserTrade[] {
  const makerOrders = trade["maker_orders"];
  if (!Array.isArray(makerOrders)) return [];
  return (makerOrders as Json[])
    .filter((o) => o["owner"] === polyApiKey)
    .map((o) => parseMaker(o, trade));
}

function parseTrades(trade: Json): UserTrade[] {
  if (trade["owner"] === polyApiKey) return [parseTaker(trade)];
  return parseMakers(trade);
}

export class LiveExecution implements ExecutionPort {
  async getUsdcBalance(): Promise<number> {
    return polyGate.usdcBalance();
  }

  async getTokenBalance(tokenId: string): Promise<number> {
    return polyGate.tokenBalance(tokenId);
  }

  async limitOrder({
    tokenID,
    side,
    price,
    size,
    tickSize,
    negRisk,
  }: LimitOrderInput): Promise<LimitOrderResult> {
    logger.debug(`limitOrder: ${side}, ${price}, ${size}`);
    const resp = await polyGate.postOrder({
      tokenID,
      side,
      price,
      size,
      tickSize: clobTickSizeStr(tickSize),
      negRisk,
      orderType: "GTC",
    });
    return { orderID: resp["orderID"] as string | undefined, success: resp["success"] as boolean | undefined };
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    const resp = await polyGate.cancelOrder(orderId);
    return cancelSucceeded(resp, orderId);
  }

  async getOrder(orderId: string): Promise<ExecutionOrder | null> {
    const raw = await polyGate.order(orderId);
    if (raw === null) return null;
    return parseOrder(raw);
  }

  async getUserTrades(tradeId: string): Promise<UserTrade[]> {
    const trades = await polyGate.userTrades(tradeId);
    const first = trades[0];
    if (first === undefined) return [];
    return parseTrades(first);
  }
}
