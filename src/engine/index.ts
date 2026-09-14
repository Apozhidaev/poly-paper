import { randomUUID } from "node:crypto";

import { getLogger } from "../logging.js";
import { MarketSocket, type TradeEvent } from "../marketData/index.js";
import { MessageQueue, Scheduler } from "../messageQueue/index.js";
import { settings } from "../settings.js";
import { markets, tradeEvents } from "../storage/index.js";
import { matchOnce } from "./matcher.js";
import { resolveOnce } from "./resolver.js";

const logger = getLogger();

export { matchOnce } from "./matcher.js";
export { resolveOnce } from "./resolver.js";

export interface PaperEngineOptions {
  tickInterval?: number;
  manageInterval?: number;
}

/**
 * Background half of the service: records public trades from the market WebSocket, matches
 * resting paper orders against them on a tick, and settles resolved markets.
 */
export class PaperEngine {
  private readonly mq: MessageQueue;
  private readonly scheduler: Scheduler;
  private readonly marketSocket: MarketSocket;

  constructor(options: PaperEngineOptions = {}) {
    const paper = settings().paper;
    this.mq = new MessageQueue({
      onError: (err) => {
        logger.error("paper engine: task failed", { error: String(err) });
      },
    });
    this.scheduler = new Scheduler({ mq: this.mq });
    this.scheduler
      .register(`PAPER_TICK(${randomUUID()})`, options.tickInterval ?? paper.tickIntervalMs)
      .subscribe(() => this.onTick());
    this.scheduler
      .register(
        `PAPER_MANAGE(${randomUUID()})`,
        options.manageInterval ?? paper.manageIntervalMs,
      )
      .subscribe(() => this.onManage());

    this.marketSocket = new MarketSocket();
    this.marketSocket.addListener("TRADE", (event: TradeEvent) => this.onTrade(event));
  }

  async start(): Promise<void> {
    await this.marketSocket.subscribe(await markets.findOpenMarketAssetsIds());
    await this.marketSocket.start();
    this.scheduler.start();
    logger.info("paper engine started");
  }

  async stop(): Promise<void> {
    this.scheduler.stop();
    this.mq.destroy();
    await this.marketSocket.stop();
    logger.info("paper engine stopped");
  }

  private async onTrade(event: TradeEvent): Promise<void> {
    await tradeEvents.insertTradeEvent({
      condition_id: event.conditionId,
      asset_id: event.assetId,
      price: event.price,
      size: event.size,
      side: event.side,
      timestamp: event.timestamp,
      transaction_hash: event.transactionHash,
    });
  }

  private async onTick(): Promise<void> {
    await this.marketSocket.addToSubscription(await markets.findOpenMarketAssetsIds());
    await matchOnce();
  }

  private async onManage(): Promise<void> {
    const settled = await resolveOnce();
    if (settled.length > 0) await this.marketSocket.removeFromSubscription(settled);
  }
}
