import { randomUUID } from "node:crypto";

import { matchTaker } from "../domain/matching.js";
import { notional, roundShares } from "../domain/money.js";
import { validateOrder } from "../domain/order.js";
import { getLogger } from "../logging.js";
import { getMarketByConditionId, getOrderbook } from "../marketData/index.js";
import { settings } from "../settings.js";
import {
  markets,
  orders,
  tradeEvents,
  trades,
  wallet,
  EPS,
  type PaperOrderDocument,
  type PaperTradeDocument,
} from "../storage/index.js";
import { nowMs, type OrderStatus, type Side } from "../types.js";
import { applyFill, releaseRemainingReserve } from "./fills.js";

const logger = getLogger();

export interface PlaceOrderRequest {
  tokenId: string;
  side: Side;
  price: number;
  size: number;
}

export type PlaceOrderResult =
  | { success: true; orderId: string }
  | { success: false; errorMsg: string };

/** Registers the market on first contact so the resolver knows what to watch and redeem. */
async function ensureMarket(conditionId: string): Promise<string | null> {
  if ((await markets.getMarket(conditionId)) !== null) return null;
  const market = await getMarketByConditionId(conditionId);
  if (market === null) return `market not found for condition_id=${conditionId}`;
  await markets.upsertMarket({
    _id: market.conditionId,
    slug: market.marketSlug,
    assets_ids: market.tokens.map((token) => token.tokenId),
    closed: false,
  });
  return null;
}

async function reserveFor(request: PlaceOrderRequest): Promise<boolean> {
  if (request.side === "BUY") {
    return wallet.tryReserveUsdc(notional(request.price, request.size));
  }
  return wallet.tryReserveTokens(request.tokenId, request.size);
}

export async function placeOrder(request: PlaceOrderRequest): Promise<PlaceOrderResult> {
  const orderbook = await getOrderbook(request.tokenId);
  if (orderbook === null) {
    return { success: false, errorMsg: `no orderbook for token_id=${request.tokenId}` };
  }

  const size = roundShares(request.size);
  const invalid = validateOrder(
    { ...request, size },
    { tickSize: orderbook.tickSize, minOrderSize: orderbook.minOrderSize },
  );
  if (invalid !== null) return { success: false, errorMsg: invalid };

  const marketError = await ensureMarket(orderbook.conditionId);
  if (marketError !== null) return { success: false, errorMsg: marketError };

  const marketDoc = await markets.getMarket(orderbook.conditionId);
  if (marketDoc?.closed === true) {
    return { success: false, errorMsg: `market ${orderbook.conditionId} is resolved` };
  }

  if (!(await reserveFor({ ...request, size }))) {
    const what = request.side === "BUY" ? "USDC" : "shares";
    return { success: false, errorMsg: `not enough ${what} for ${request.side}` };
  }

  const order: PaperOrderDocument = {
    _id: randomUUID(),
    asset_id: request.tokenId,
    side: request.side,
    price: request.price,
    original_size: size,
    size_matched: 0,
    status: "LIVE",
    created_at: nowMs(),
    associate_trades: [],
    condition_id: orderbook.conditionId,
    // Only trades observed from now on can fill this order.
    cursor_event: await tradeEvents.latestEventId(),
  };
  await orders.insertOrder(order);
  logger.debug("paper order placed", {
    order_id: order._id,
    side: order.side,
    price: order.price,
    size: order.original_size,
  });

  if (settings().paper.instantTakerFill) {
    let current = order;
    for (const fill of matchTaker({
      side: order.side,
      limitPrice: order.price,
      size: order.original_size,
      orderbook,
    })) {
      const result = await applyFill(current, fill);
      if (!result.applied) break;
      current = { ...current, size_matched: result.sizeMatched };
      if (current.size_matched >= current.original_size - EPS) break;
    }
  }

  return { success: true, orderId: order._id };
}

export async function cancelOrder(
  orderId: string,
  finalStatus: OrderStatus = "CANCELED",
): Promise<boolean> {
  const order = await orders.takeLiveOrderForCancel(orderId, finalStatus);
  if (order === null) return false;
  await releaseRemainingReserve(order);
  logger.debug("paper order canceled", { order_id: orderId, status: finalStatus });
  return true;
}

export async function cancelAllOrders(
  finalStatus: OrderStatus = "CANCELED",
): Promise<string[]> {
  const canceled: string[] = [];
  for (const order of await orders.findLiveOrders()) {
    if (await cancelOrder(order._id, finalStatus)) canceled.push(order._id);
  }
  return canceled;
}

export async function getOrder(orderId: string): Promise<PaperOrderDocument | null> {
  return orders.getOrder(orderId);
}

export async function getTrade(tradeId: string): Promise<PaperTradeDocument | null> {
  return trades.findTradeById(tradeId);
}
