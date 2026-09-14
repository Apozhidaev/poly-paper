import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { startTestEnv, type TestEnv } from "../helpers/env.js";

const TOKEN = "token-yes";
const CONDITION = "cond-1";

let env: TestEnv;

async function get(url: string) {
  const res = await env.app.inject({ method: "GET", url });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

beforeAll(async () => {
  env = await startTestEnv({ initialUsdc: 1000, instantTakerFill: false, docs: true });
  env.gateway.setBook(TOKEN, {
    conditionId: CONDITION,
    asks: [[0.6, 50]],
    bids: [[0.4, 50]],
  });
  env.gateway.setMarket(CONDITION, { tokens: [{ tokenId: TOKEN, outcome: "Yes" }] });
});

afterAll(async () => {
  await env.close();
});

beforeEach(async () => {
  await env.resetState();
});

describe("health", () => {
  it("reports Mongo and the upstream it proxies to", async () => {
    const { body } = await get("/health");
    expect(body).toMatchObject({ status: "ok", mongo: true, upstream: env.gateway.url });
  });

  it("counts orders by status", async () => {
    await env.app.inject({
      method: "POST",
      url: "/clob/order",
      payload: { tokenID: TOKEN, side: "BUY", price: 0.5, size: 10 },
    });
    const { body } = await get("/health");
    expect(body["orders"]).toEqual({ LIVE: 1 });
  });
});

describe("wallet endpoints", () => {
  it("shows balances and positions", async () => {
    await env.storage.wallet.creditTokens(TOKEN, 12);
    await env.app.inject({
      method: "POST",
      url: "/clob/order",
      payload: { tokenID: TOKEN, side: "SELL", price: 0.7, size: 10 },
    });

    const { body } = await get("/paper/wallet");
    expect(body).toEqual({
      usdcAvailable: 1000,
      usdcReserved: 0,
      positions: [{ assetId: TOKEN, free: 2, reserved: 10, total: 12 }],
    });
  });

  it("marks positions at the book mid price and derives PnL", async () => {
    await env.storage.wallet.creditTokens(TOKEN, 100);
    const { body } = await get("/paper/portfolio");
    expect(body).toMatchObject({
      usdcAvailable: 1000,
      usdcReserved: 0,
      // mid of 0.4 / 0.6
      positionsValue: 50,
      total: 1050,
      pnl: 50,
      positions: [{ assetId: TOKEN, total: 100, markPrice: 0.5, value: 50 }],
    });
  });

  it("takes deposits", async () => {
    const res = await env.app.inject({
      method: "POST",
      url: "/paper/wallet/deposit",
      payload: { usdc: 250 },
    });
    expect(res.json()).toMatchObject({ usdcAvailable: 1250 });
  });

  it("rejects a non-positive deposit", async () => {
    const res = await env.app.inject({
      method: "POST",
      url: "/paper/wallet/deposit",
      payload: { usdc: 0 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("cancels open orders when reset, so no reserve is stranded", async () => {
    await env.storage.wallet.creditTokens(TOKEN, 20);
    await env.app.inject({
      method: "POST",
      url: "/clob/order",
      payload: { tokenID: TOKEN, side: "BUY", price: 0.5, size: 10 },
    });

    const res = await env.app.inject({
      method: "POST",
      url: "/paper/wallet/reset",
      payload: { usdc: 500 },
    });
    expect(res.json()).toEqual({ usdcAvailable: 500, usdcReserved: 0, positions: [] });

    const orders = (await get("/paper/orders?status=CANCELED")).body;
    expect(orders).toHaveLength(1);
  });
});

describe("order listing", () => {
  it("filters by status and asset", async () => {
    const first = await env.app.inject({
      method: "POST",
      url: "/clob/order",
      payload: { tokenID: TOKEN, side: "BUY", price: 0.5, size: 10 },
    });
    const orderId = (first.json() as { orderID: string }).orderID;
    await env.app.inject({
      method: "POST",
      url: "/clob/order",
      payload: { tokenID: TOKEN, side: "BUY", price: 0.4, size: 10 },
    });
    await env.app.inject({ method: "DELETE", url: "/clob/order", payload: { orderID: orderId } });

    expect((await get("/paper/orders")).body).toHaveLength(2);
    expect((await get("/paper/orders?status=LIVE")).body).toHaveLength(1);
    expect((await get(`/paper/orders?assetId=${TOKEN}&status=CANCELED`)).body).toHaveLength(1);
    expect((await get("/paper/orders?assetId=other")).body).toHaveLength(0);
  });

  it("rejects an out-of-range limit", async () => {
    const res = await env.app.inject({ method: "GET", url: "/paper/orders?limit=5000" });
    expect(res.statusCode).toBe(400);
  });
});

describe("market data proxy", () => {
  it("passes the upstream orderbook through unchanged", async () => {
    const { status, body } = await get(`/clob/order-book?token_id=${TOKEN}`);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      asset_id: TOKEN,
      market: CONDITION,
      tick_size: "0.01",
      min_order_size: "5",
    });
    expect(body["asks"]).toEqual([{ price: "0.6", size: "50" }]);
  });

  it("404s for a token with no book", async () => {
    expect((await get("/clob/order-book?token_id=nope")).status).toBe(404);
  });

  it("serves books in bulk", async () => {
    const res = await env.app.inject({
      method: "POST",
      url: "/clob/order-books",
      payload: [{ token_id: TOKEN }, { token_id: "nope" }],
    });
    expect(res.json()).toHaveLength(1);
  });

  it("passes markets through and 404s unknown ones", async () => {
    const { body } = await get(`/clob/markets/${CONDITION}`);
    expect(body).toMatchObject({ condition_id: CONDITION, market_slug: `slug-${CONDITION}` });
    expect((await get("/clob/markets/nope")).status).toBe(404);
  });
});

describe("swagger", () => {
  it("documents every route group", async () => {
    const { body } = await get("/docs/json");
    const paths = Object.keys(body["paths"] as Record<string, unknown>);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/clob/order",
        "/clob/order/{orderID}",
        "/clob/user-trades",
        "/clob/usdc-balance",
        "/clob/token-balance",
        "/clob/order-book",
        "/clob/order-books",
        "/clob/markets/{conditionId}",
        "/health",
        "/paper/wallet",
        "/paper/portfolio",
        "/paper/orders",
      ]),
    );
  });

  it("serves the UI", async () => {
    const res = await env.app.inject({ method: "GET", url: "/docs" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
  });
});
