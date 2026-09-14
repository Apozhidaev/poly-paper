import { randomUUID } from "node:crypto";

import { getMarketByConditionId, getOrderbook } from "./client";
import { getTry } from "./config";
import { getLogger } from "./logging";
import { Scheduler, type MessageQueue } from "./message-queue";
import { MarketSocket, type TradeEvent } from "./socket";
import { nowMs, type Millis } from "./types";
import { tryMatchTradeEvents } from "./matching.js";
import { cancelLiveOrder } from "./paperExecution.js";
import * as ps from "./storage.js";

const logger = getLogger();

const DEFAULT_TICK_INTERVAL_MS = 1_000;
const DEFAULT_MANAGE_INTERVAL_MS = 600_000;
const DEFAULT_INITIAL_USDC = 10_000;

function defaultInitialUsdc(): number {
  const value = getTry<number>("paper.initial_usdc");
  return value === null ? DEFAULT_INITIAL_USDC : Number(value);
}

export interface PaperMarketOptions {
  tickInterval?: Millis;
  manageInterval?: Millis;
  mq: MessageQueue;
}

/** Tick-driven matching of virtual orders against the live book. */
export class PaperMarket {
  private readonly scheduler: Scheduler;
  private readonly marketSocket: MarketSocket;

  constructor({
    tickInterval = DEFAULT_TICK_INTERVAL_MS,
    manageInterval = DEFAULT_MANAGE_INTERVAL_MS,
    mq,
  }: PaperMarketOptions) {
    this.scheduler = new Scheduler({ mq });
    this.scheduler
      .register(`PAPER_TICK(${randomUUID()})`, tickInterval)
      .subscribe(() => this.onPaperTick());
    this.scheduler
      .register(`PAPER_MANAGE(${randomUUID()})`, manageInterval)
      .subscribe(() => this.onPaperManage());
    this.marketSocket = new MarketSocket();
    this.marketSocket.addListener("TRADE", (event: TradeEvent) => this.onTrade(event));
  }

  async start(): Promise<void> {
    await ps.initIndexes();
    await ps.ensureWallet(defaultInitialUsdc());
    this.scheduler.start();
    await this.marketSocket.start();
  }

  async stop(): Promise<void> {
    this.scheduler.stop();
    await this.marketSocket.stop();
  }

  private async onTrade(event: TradeEvent): Promise<void> {
    await ps.insertTradeEvent({
      condition_id: event.conditionId,
      asset_id: event.assetId,
      price: event.price,
      size: event.size,
      side: event.side,
      timestamp: event.timestamp,
      transaction_hash: event.transactionHash,
    });
  }

  private async onPaperTick(): Promise<void> {
    await this.marketSocket.addToSubscription(await ps.findOpenMarketAssetsIds());
    for (const order of await ps.findLiveOrders()) {
      await this.tryMatchOrder(order);
    }
  }

  private async onPaperManage(): Promise<void> {
    logger.info("paper market: on_manage");
    const assetsIdsToRemove: string[] = [];
    for (const marketDoc of await ps.findOpenMarkets()) {
      const conditionId = marketDoc._id;
      const market = await getMarketByConditionId(conditionId);
      if (market === null) {
        logger.error("paper redeem: market not found", { condition_id: conditionId });
        continue;
      }

      const winningTokenId = market.winningTokenId;
      if (winningTokenId === null) continue;

      const orders = await ps.findLiveOrdersForCondition(conditionId);
      if (orders.length > 0) {
        for (const order of orders) {
          await cancelLiveOrder(order._id, "CANCELED_MARKET_RESOLVED");
        }
        continue;
      }

      const assetsIds = marketDoc.assets_ids ?? [];
      assetsIdsToRemove.push(...assetsIds);

      const payout = await ps.redeemOutcomeTokens(assetsIds, winningTokenId);
      if (payout > 0) {
        logger.info("paper redeem: credited usdc", {
          credited_usdc: payout,
          condition_id: conditionId,
          winning_token: winningTokenId,
        });
      }

      await ps.closeMarket(conditionId, winningTokenId);
    }

    if (assetsIdsToRemove.length > 0) {
      await this.marketSocket.removeFromSubscription(assetsIdsToRemove);
    }
  }

  private async tryMatchOrder(doc: ps.PaperOrderDocument): Promise<void> {
    const orderbook = await getOrderbook(doc.asset_id);
    if (orderbook === null) {
      await cancelLiveOrder(doc._id, "CANCELED_MARKET_RESOLVED");
      return;
    }

    const remaining = doc.original_size - doc.size_matched;
    const oppositeSide = doc.side === "BUY" ? "SELL" : "BUY";
    const events = await ps.findTradeEventsSince(doc.asset_id, oppositeSide, doc.created_at);
    if (
      tryMatchTradeEvents({
        side: doc.side,
        limitPrice: doc.price,
        orderSize: remaining,
        events,
      })
    ) {
      await this.applyMatch(doc);
    }
  }

  private async applyMatch(doc: ps.PaperOrderDocument): Promise<void> {
    const tradeId = randomUUID();
    const fillPrice = doc.price;
    const fillQty = doc.original_size;

    await ps.insertTrade({
      trade_id: tradeId,
      order_id: doc._id,
      asset_id: doc.asset_id,
      condition_id: doc.condition_id,
      avg_price: fillPrice,
      matched_amount: fillQty,
      side: doc.side,
      match_time: nowMs(),
    });

    if (doc.side === "BUY") {
      await ps.applyBuyFill(doc.price, fillQty, fillPrice);
      await ps.creditTokens(doc.asset_id, fillQty);
    } else {
      await ps.applySellFill(doc.asset_id, fillQty, fillPrice);
    }

    await ps.updateOrder(doc._id, {
      size_matched: fillQty,
      associate_trades: [tradeId],
      status: "MATCHED",
    });
  }
}
