import { WebSocket } from "ws";

import { parseOrderbook } from "../../client/orderbook.js";
import { getLogger } from "../../logging.js";
import { Signal, sleep } from "../../utils/signal.js";
import type { OrderBook } from "../../types.js";
import { parseBookChange, parseTrade } from "./parse.js";
import type { BookChangeEvent, MarketEventType, TradeEvent } from "./types.js";

const logger = getLogger();

const PING_INTERVAL_MS = 10_000;
const RECONNECT_DELAY_MS = 1_000;

export interface MarketEventPayload {
  BOOK: OrderBook;
  TRADE: TradeEvent;
  BOOK_CHANGE: BookChangeEvent;
}

export type MarketListener<E extends MarketEventType = MarketEventType> = (
  payload: MarketEventPayload[E],
) => Promise<unknown> | unknown;

type AnyListener = (payload: never) => Promise<unknown> | unknown;

/** Polymarket Market WebSocket: idle with no assets; connect/reconnect when subscribed. */
export class MarketSocket {
  static readonly WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";

  private readonly customFeatureEnabled: boolean;

  private ws: WebSocket | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectLoop: Promise<void> | null = null;

  private assetsIds: string[] = [];
  private readonly assetsReady = new Signal();
  private readonly stopping = new Signal();
  private running = false;
  private reconnectCount = 0;
  private readonly listeners = new Map<MarketEventType, AnyListener[]>();

  /** Handlers run one at a time, matching the serial `async for` loop of the Python client. */
  private dispatchChain: Promise<void> = Promise.resolve();

  constructor(customFeatureEnabled = false) {
    this.customFeatureEnabled = customFeatureEnabled;
  }

  getAssets(): string[] {
    return [...this.assetsIds];
  }

  addListener<E extends MarketEventType>(event: E, listener: MarketListener<E>): () => void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener as AnyListener);
    this.listeners.set(event, list);
    return () => {
      this.removeListener(event, listener);
    };
  }

  removeListener<E extends MarketEventType>(event: E, listener: MarketListener<E>): void {
    const list = this.listeners.get(event);
    if (list === undefined) return;
    this.listeners.set(
      event,
      list.filter((l) => l !== (listener as AnyListener)),
    );
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.reconnectCount = 0;
    this.stopping.clear();
    this.reconnectLoop = this.runReconnectLoop();
    logger.info("market_socket_started");
  }

  async stop(): Promise<void> {
    this.running = false;
    this.stopping.set();
    this.assetsReady.set();
    await this.cleanupConnection();
    const loop = this.reconnectLoop;
    this.reconnectLoop = null;
    if (loop !== null) await loop;
    logger.info("market_socket_stopped");
  }

  /** Replace the full subscription. An empty list enters idle (no WebSocket). */
  async subscribe(assetsIds: string[]): Promise<void> {
    this.assetsIds = [...assetsIds];
    if (this.isOpen() && this.hasAssets()) await this.sendSubscribeMessage();
    await this.notifyAssetsChanged();
  }

  async addToSubscription(assetsIds: string[]): Promise<void> {
    if (assetsIds.length === 0) return;

    const newIds = assetsIds.filter((aid) => !this.assetsIds.includes(aid));
    if (newIds.length === 0) return;

    this.assetsIds.push(...newIds);

    if (this.isOpen() && this.hasAssets()) {
      this.send({
        operation: "subscribe",
        assets_ids: newIds,
        custom_feature_enabled: this.customFeatureEnabled,
      });
      logger.info("market_socket_subscription_added", { count: newIds.length });
    }

    await this.notifyAssetsChanged();
  }

  async removeFromSubscription(assetsIds: string[]): Promise<void> {
    if (assetsIds.length === 0) return;

    const toRemove = new Set(assetsIds);
    this.assetsIds = this.assetsIds.filter((aid) => !toRemove.has(aid));

    if (this.isOpen() && this.hasAssets()) {
      this.send({
        operation: "unsubscribe",
        assets_ids: [...toRemove],
        custom_feature_enabled: this.customFeatureEnabled,
      });
      logger.info("market_socket_subscription_removed", { count: toRemove.size });
    }

    await this.notifyAssetsChanged();
  }

  private isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  private hasAssets(): boolean {
    return this.assetsIds.length > 0;
  }

  private send(payload: unknown): void {
    this.ws?.send(JSON.stringify(payload));
  }

  private async sendSubscribeMessage(): Promise<void> {
    this.send({
      assets_ids: this.assetsIds,
      type: "market",
      custom_feature_enabled: this.customFeatureEnabled,
      initial_dump: true,
    });
    logger.info("market_socket_subscribed", { count: this.assetsIds.length });
  }

  private async enterIdle(): Promise<void> {
    this.assetsReady.clear();
    await this.cleanupConnection();
  }

  private async waitForAssets(): Promise<void> {
    while (this.running && !this.hasAssets()) {
      await this.assetsReady.wait();
    }
  }

  private async notifyAssetsChanged(): Promise<void> {
    if (this.hasAssets()) {
      this.assetsReady.set();
    } else {
      await this.enterIdle();
    }
  }

  private async runReconnectLoop(): Promise<void> {
    while (this.running) {
      if (!this.hasAssets()) {
        await this.enterIdle();
        await this.waitForAssets();
        continue;
      }

      try {
        await this.runConnection();
      } catch (exc) {
        if (!this.running) break;
        this.reconnectCount += 1;
        logger.warning("market_socket_connection_lost", {
          error: String(exc),
          attempt: this.reconnectCount,
        });
        await sleep(RECONNECT_DELAY_MS, this.stopping);
      } finally {
        await this.cleanupConnection();
      }
    }
  }

  /** Resolves once the socket closes; rejects if it errors. */
  private async runConnection(): Promise<void> {
    const socket = new WebSocket(MarketSocket.WS_URL);
    this.ws = socket;

    const closed = new Promise<void>((resolve, reject) => {
      socket.once("close", () => {
        resolve();
      });
      socket.once("error", (err: Error) => {
        reject(err);
      });
    });
    // The open handshake below rejects on the same error, so keep this one observed.
    void closed.catch(() => undefined);

    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => {
        resolve();
      });
      socket.once("error", (err: Error) => {
        reject(err);
      });
    });
    logger.info("market_socket_connected", { attempt: this.reconnectCount + 1 });

    this.startPing(socket);
    socket.on("message", (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        logger.warning("market_socket_binary_message");
        return;
      }
      this.enqueue(data.toString("utf8"));
    });

    if (this.hasAssets()) await this.sendSubscribeMessage();

    await closed;
  }

  private startPing(socket: WebSocket): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (!this.running || socket.readyState !== WebSocket.OPEN) return;
      socket.send("PING");
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private async cleanupConnection(): Promise<void> {
    this.stopPing();
    const socket = this.ws;
    this.ws = null;
    if (socket === null) return;
    socket.removeAllListeners("message");
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.terminate();
    }
    await this.dispatchChain;
  }

  private enqueue(message: string): void {
    this.dispatchChain = this.dispatchChain.then(() => this.onMessage(message));
  }

  private async onMessage(message: string): Promise<void> {
    if (message === "PONG") return;
    if (!message.includes("event_type")) {
      logger.warning("market_socket_invalid_format", { message });
      return;
    }
    let data: unknown;
    try {
      data = JSON.parse(message);
    } catch {
      logger.warning("market_socket_invalid_json", { message: message.slice(0, 200) });
      return;
    }
    if (Array.isArray(data)) {
      for (const item of data) {
        if (typeof item === "object" && item !== null) {
          await this.handleEvent(item as Record<string, unknown>);
        }
      }
    } else if (typeof data === "object" && data !== null) {
      await this.handleEvent(data as Record<string, unknown>);
    }
  }

  private async handleEvent(event: Record<string, unknown>): Promise<void> {
    switch (event["event_type"]) {
      case "price_change":
        if (this.hasListeners("BOOK_CHANGE")) {
          await this.dispatch("BOOK_CHANGE", parseBookChange(event));
        }
        break;
      case "book":
        if (this.hasListeners("BOOK")) {
          await this.dispatch("BOOK", parseOrderbook(event));
        }
        break;
      case "last_trade_price":
        if (this.hasListeners("TRADE")) {
          await this.dispatch("TRADE", parseTrade(event));
        }
        break;
      default:
        break;
    }
  }

  private hasListeners(event: MarketEventType): boolean {
    return (this.listeners.get(event) ?? []).length > 0;
  }

  private async dispatch(event: MarketEventType, payload: unknown): Promise<void> {
    for (const fn of this.listeners.get(event) ?? []) {
      try {
        await (fn as (payload: unknown) => Promise<unknown> | unknown)(payload);
      } catch (exc) {
        logger.warning("listener_error", { error: String(exc) });
      }
    }
  }
}
