import { randomUUID } from "node:crypto";

import {
  getMarketByConditionId,
  getOrderbook,
  type ExecutionOrder,
  type ExecutionPort,
  type LimitOrderInput,
  type LimitOrderResult,
  type OrderStatus,
  type UserTrade,
} from "./client";
import { getLogger } from "./logging";
import * as ps from "./storage.js";

const logger = getLogger();

/** Release the remaining reserve of a LIVE paper order and set a terminal status. */
export async function cancelLiveOrder(
  orderId: string,
  finalStatus: OrderStatus = "CANCELED",
): Promise<boolean> {
  const doc = await ps.getOrderDoc(orderId);
  if (doc === null || doc.status !== "LIVE") return false;
  const remaining = doc.original_size - doc.size_matched;
  if (remaining <= 0) return false;
  if (doc.side === "BUY") {
    await ps.releaseBuyReserve(doc.price, remaining);
  } else {
    await ps.releaseSellReserve(doc.asset_id, remaining);
  }
  await ps.updateOrder(orderId, { status: finalStatus });
  return true;
}

function toExecutionOrder(doc: ps.PaperOrderDocument): ExecutionOrder {
  return {
    status: doc.status,
    price: doc.price,
    originalSize: doc.original_size,
    sizeMatched: doc.size_matched,
    createdAt: doc.created_at,
    associateTrades: [...doc.associate_trades],
  };
}

function toUserTrade(doc: ps.PaperTradeDocument): UserTrade {
  return {
    tradeId: doc.trade_id,
    orderId: doc.order_id,
    conditionId: doc.condition_id,
    assetId: doc.asset_id,
    avgPrice: doc.avg_price,
    matchedAmount: doc.matched_amount,
    side: doc.side,
    matchTime: doc.match_time,
  };
}

async function syncNewMarket(conditionId: string): Promise<void> {
  if ((await ps.getMarketDoc(conditionId)) !== null) return;
  const market = await getMarketByConditionId(conditionId);
  if (market === null) {
    throw new Error(`market not found for condition_id='${conditionId}'`);
  }
  await ps.insertMarket({
    _id: market.conditionId,
    slug: market.marketSlug,
    assets_ids: market.tokens.map((token) => token.tokenId),
    closed: false,
  });
}

export class PaperExecution implements ExecutionPort {
  async getUsdcBalance(): Promise<number> {
    const wallet = await ps.getWallet();
    return wallet?.usdc_available ?? 0;
  }

  async getTokenBalance(tokenId: string): Promise<number> {
    const wallet = await ps.getWallet();
    return Number(wallet?.tokens[tokenId] ?? 0);
  }

  async limitOrder({
    tokenID,
    side,
    price,
    size,
  }: LimitOrderInput): Promise<LimitOrderResult> {
    const orderbook = await getOrderbook(tokenID);
    if (orderbook === null) {
      logger.warning("paper: orderbook not found", { token_id: tokenID });
      return { success: false };
    }

    await syncNewMarket(orderbook.conditionId);

    if (side === "BUY") {
      if (!(await ps.tryReserveBuy(price, size))) {
        logger.warning("paper: insufficient USDC for BUY");
        return { success: false };
      }
    } else if (!(await ps.tryReserveSell(tokenID, size))) {
      logger.warning("paper: insufficient tokens for SELL");
      return { success: false };
    }

    const orderId = randomUUID();
    await ps.insertOrder({
      _id: orderId,
      asset_id: tokenID,
      side,
      price,
      original_size: size,
      size_matched: 0,
      status: "LIVE",
      created_at: orderbook.timestamp,
      associate_trades: [],
      condition_id: orderbook.conditionId,
    });
    logger.debug(`paper limit_order: ${side} ${price} ${size}`);
    return { orderID: orderId, success: true };
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    return cancelLiveOrder(orderId, "CANCELED");
  }

  async getOrder(orderId: string): Promise<ExecutionOrder | null> {
    const doc = await ps.getOrderDoc(orderId);
    if (doc === null) return null;
    return toExecutionOrder(doc);
  }

  async getUserTrades(tradeId: string): Promise<UserTrade[]> {
    const doc = await ps.findTradeById(tradeId);
    if (doc === null) return [];
    return [toUserTrade(doc)];
  }
}
