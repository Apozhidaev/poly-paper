import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";
import { MongoMemoryServer } from "mongodb-memory-server";
import { stringify } from "yaml";

import { startFakeGateway, type FakeGateway } from "./gateway.js";

type Storage = typeof import("../../src/storage/index.js");
type OrderService = typeof import("../../src/service/orders.js");
type WalletService = typeof import("../../src/service/wallet.js");
type Matcher = typeof import("../../src/engine/matcher.js");
type Resolver = typeof import("../../src/engine/resolver.js");

export interface TestEnv {
  app: FastifyInstance;
  gateway: FakeGateway;
  storage: Storage;
  orderService: OrderService;
  walletService: WalletService;
  matchOnce: Matcher["matchOnce"];
  resolveOnce: Resolver["resolveOnce"];
  initialUsdc: number;
  resetState(): Promise<void>;
  close(): Promise<void>;
}

export interface TestEnvOptions {
  initialUsdc?: number;
  instantTakerFill?: boolean;
  docs?: boolean;
}

/**
 * Boots the service against an in-memory Mongo and a fake upstream gateway. The engine is not
 * started — its WebSocket would reach for the real Polymarket feed — so tests drive
 * `matchOnce`/`resolveOnce` themselves.
 *
 * Source modules are imported dynamically because they read the config at import time, and
 * the config file only exists once this function runs.
 */
export async function startTestEnv(options: TestEnvOptions = {}): Promise<TestEnv> {
  const initialUsdc = options.initialUsdc ?? 1000;
  const gateway = await startFakeGateway();
  const mongod = await MongoMemoryServer.create();

  const dir = mkdtempSync(join(tmpdir(), "poly-paper-test-"));
  const configPath = join(dir, "config.yaml");
  writeFileSync(
    configPath,
    stringify({
      log: { level: "ERROR", mongo: false },
      db: { name: "poly_paper_test" },
      server: { host: "127.0.0.1", port: 0 },
      docs: { enabled: options.docs ?? false, route: "/docs" },
      poly_gate: { url: gateway.url },
      polymarket: { api_key: "test-api-key", maker_address: "0xtest" },
      paper: {
        initial_usdc: initialUsdc,
        tick_interval: 3600,
        manage_interval: 3600,
        instant_taker_fill: options.instantTakerFill ?? false,
      },
    }),
  );
  process.env["POLY_PAPER_CONFIG"] = configPath;
  process.env["MONGO_URL"] = mongod.getUri();

  const { setupLogging } = await import("../../src/logging.js");
  setupLogging("ERROR", null);

  const mongo = await import("../../src/mongo.js");
  const storage = await import("../../src/storage/index.js");
  const orderService = await import("../../src/service/orders.js");
  const walletService = await import("../../src/service/wallet.js");
  const { matchOnce } = await import("../../src/engine/matcher.js");
  const { resolveOnce } = await import("../../src/engine/resolver.js");
  const { buildApp } = await import("../../src/http/app.js");

  await storage.initIndexes();
  await storage.wallet.ensureWallet(initialUsdc);

  const app = await buildApp();
  await app.ready();

  return {
    app,
    gateway,
    storage,
    orderService,
    walletService,
    matchOnce,
    resolveOnce,
    initialUsdc,
    async resetState() {
      const db = mongo.connect();
      for (const name of [
        storage.COL_BALANCE,
        storage.COL_ORDER,
        storage.COL_TRADE,
        storage.COL_MARKET,
        storage.COL_TRADE_EVENT,
      ]) {
        await db.collection(name).deleteMany({});
      }
      await storage.wallet.ensureWallet(initialUsdc);
    },
    async close() {
      await app.close();
      await mongo.close();
      await mongod.stop();
      await gateway.close();
    },
  };
}
