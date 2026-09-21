import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { startTestEnv, type TestEnv } from "../helpers/env.js";

const TOKEN = "token-yes";
const OTHER_TOKEN = "token-no";
const CONDITION = "cond-1";

let env: TestEnv;

async function placeOrder(body: Record<string, unknown>) {
  const res = await env.app.inject({
    method: "POST",
    url: "/clob/order",
    payload: { orderType: "GTC", ...body },
  });
  return res.json() as { orderID?: string; success: boolean; errorMsg?: string };
}

async function usdcBalance(): Promise<number> {
  const res = await env.app.inject({ method: "GET", url: "/clob/usdc-balance" });
  return (res.json() as { balance: number }).balance;
}

async function tokenBalance(tokenId: string): Promise<number> {
  const res = await env.app.inject({
    method: "GET",
    url: `/clob/token-balance?token_id=${tokenId}`,
  });
  return (res.json() as { balance: number }).balance;
}

async function getOrder(orderId: string) {
  const res = await env.app.inject({ method: "GET", url: `/clob/order/${orderId}` });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

/** Public trade prints the engine matches resting orders against. */
async function recordTrade(tokenId: string, side: "BUY" | "SELL", price: number, size: number) {
  await env.storage.tradeEvents.insertTradeEvent({
    condition_id: CONDITION,
    asset_id: tokenId,
    price,
    size,
    side,
    timestamp: Date.now(),
    transaction_hash: `0x${Math.random().toString(16).slice(2)}`,
  });
}

beforeAll(async () => {
  env = await startTestEnv({ initialUsdc: 1000, instantTakerFill: false });
  env.gateway.setBook(TOKEN, {
    conditionId: CONDITION,
    asks: [[0.6, 50]],
    bids: [[0.4, 50]],
    tickSize: 0.01,
    minOrderSize: 5,
  });
  env.gateway.setBook(OTHER_TOKEN, {
    conditionId: CONDITION,
    asks: [[0.4, 50]],
    bids: [[0.6, 50]],
  });
  env.gateway.setMarket(CONDITION, {
    tokens: [
      { tokenId: TOKEN, outcome: "Yes" },
      { tokenId: OTHER_TOKEN, outcome: "No" },
    ],
  });
});

afterAll(async () => {
  await env.close();
});

beforeEach(async () => {
  await env.resetState();
});

describe("placing orders", () => {
  it("reserves USDC for a resting BUY and reports it in the CLOB shape", async () => {
    const placed = await placeOrder({ tokenID: TOKEN, side: "BUY", price: 0.5, size: 10 });
    expect(placed.success).toBe(true);
    expect(placed.orderID).toBeTypeOf("string");

    expect(await usdcBalance()).toBe(995);

    const { status, body } = await getOrder(placed.orderID!);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      id: placed.orderID,
      status: "LIVE",
      market: CONDITION,
      asset_id: TOKEN,
      side: "BUY",
      price: "0.5",
      original_size: "10",
      size_matched: "0",
      type: "GTC",
      owner: "test-api-key",
      associate_trades: [],
    });
    // The CLOB reports creation time in seconds, not milliseconds.
    expect(body["created_at"]).toBeCloseTo(Math.floor(Date.now() / 1000), -1);
  });

  it("registers the market on first contact", async () => {
    await placeOrder({ tokenID: TOKEN, side: "BUY", price: 0.5, size: 10 });
    const res = await env.app.inject({ method: "GET", url: "/paper/markets" });
    expect(res.json()).toEqual([
      {
        conditionId: CONDITION,
        slug: `slug-${CONDITION}`,
        assetsIds: [TOKEN, OTHER_TOKEN],
        closed: false,
        winningTokenId: null,
        closedAt: null,
      },
    ]);
  });

  it("reserves shares for a SELL and hides them from the free balance", async () => {
    await env.storage.wallet.creditTokens(TOKEN, 20);
    const placed = await placeOrder({ tokenID: TOKEN, side: "SELL", price: 0.7, size: 10 });
    expect(placed.success).toBe(true);
    expect(await tokenBalance(TOKEN)).toBe(10);
  });

  it("rejects an order it cannot fund with success=false, not an error status", async () => {
    const res = await env.app.inject({
      method: "POST",
      url: "/clob/order",
      payload: { tokenID: TOKEN, side: "BUY", price: 0.99, size: 5000 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: false });
    expect((res.json() as { errorMsg: string }).errorMsg).toMatch(/not enough USDC/);
    expect(await usdcBalance()).toBe(1000);
  });

  it("rejects a SELL with no shares", async () => {
    const placed = await placeOrder({ tokenID: TOKEN, side: "SELL", price: 0.7, size: 10 });
    expect(placed.success).toBe(false);
    expect(placed.errorMsg).toMatch(/not enough shares/);
  });

  it("enforces tick size, minimum size and existence of a book", async () => {
    expect((await placeOrder({ tokenID: TOKEN, side: "BUY", price: 0.505, size: 10 })).errorMsg)
      .toMatch(/tick size/);
    expect((await placeOrder({ tokenID: TOKEN, side: "BUY", price: 0.5, size: 1 })).errorMsg)
      .toMatch(/minimum order size/);
    expect((await placeOrder({ tokenID: "nope", side: "BUY", price: 0.5, size: 10 })).errorMsg)
      .toMatch(/no orderbook/);
  });

  it("validates the request body", async () => {
    const res = await env.app.inject({
      method: "POST",
      url: "/clob/order",
      payload: { tokenID: TOKEN, side: "SIDEWAYS", price: 0.5, size: 10 },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("matching against public trades", () => {
  it("fills a resting BUY in parts as volume trades through it", async () => {
    const placed = await placeOrder({ tokenID: TOKEN, side: "BUY", price: 0.5, size: 10 });
    const orderId = placed.orderID!;

    // Trades at or above the limit never fill a resting BUY.
    await recordTrade(TOKEN, "SELL", 0.5, 100);
    await env.matchOnce();
    expect((await getOrder(orderId)).body["size_matched"]).toBe("0");

    await recordTrade(TOKEN, "SELL", 0.49, 4);
    await env.matchOnce();
    let order = (await getOrder(orderId)).body;
    expect(order["size_matched"]).toBe("4");
    expect(order["status"]).toBe("LIVE");
    expect(await tokenBalance(TOKEN)).toBe(4);

    await recordTrade(TOKEN, "SELL", 0.45, 25);
    await env.matchOnce();
    order = (await getOrder(orderId)).body;
    expect(order["size_matched"]).toBe("10");
    expect(order["status"]).toBe("MATCHED");
    expect(await tokenBalance(TOKEN)).toBe(10);

    // Reserved 5 USDC at the limit price and paid exactly that, since fills book at the limit.
    expect(await usdcBalance()).toBe(995);
    const wallet = await env.storage.wallet.getWallet();
    expect(wallet?.usdc_reserved).toBeCloseTo(0, 9);
    expect(order["associate_trades"]).toHaveLength(2);
  });

  it("does not re-consume trades once an order has looked at them", async () => {
    const placed = await placeOrder({ tokenID: TOKEN, side: "BUY", price: 0.5, size: 10 });
    await recordTrade(TOKEN, "SELL", 0.49, 4);
    await env.matchOnce();
    await env.matchOnce();
    expect((await getOrder(placed.orderID!)).body["size_matched"]).toBe("4");
  });

  it("ignores trades that arrived before the order existed", async () => {
    await recordTrade(TOKEN, "SELL", 0.4, 100);
    const placed = await placeOrder({ tokenID: TOKEN, side: "BUY", price: 0.5, size: 10 });
    await env.matchOnce();
    expect((await getOrder(placed.orderID!)).body["size_matched"]).toBe("0");
  });

  it("credits USDC when a resting SELL is filled", async () => {
    await env.storage.wallet.creditTokens(TOKEN, 20);
    const placed = await placeOrder({ tokenID: TOKEN, side: "SELL", price: 0.6, size: 10 });

    await recordTrade(TOKEN, "BUY", 0.61, 10);
    await env.matchOnce();

    const order = (await getOrder(placed.orderID!)).body;
    expect(order["status"]).toBe("MATCHED");
    expect(await usdcBalance()).toBe(1006);
    expect(await tokenBalance(TOKEN)).toBe(10);
  });

  it("exposes fills through /clob/user-trades in the taker shape", async () => {
    const placed = await placeOrder({ tokenID: TOKEN, side: "BUY", price: 0.5, size: 10 });
    await recordTrade(TOKEN, "SELL", 0.49, 10);
    await env.matchOnce();

    const [tradeId] = (await getOrder(placed.orderID!)).body["associate_trades"] as string[];
    const res = await env.app.inject({ method: "GET", url: `/clob/user-trades?id=${tradeId}` });
    expect(res.json()).toEqual([
      {
        id: tradeId,
        taker_order_id: placed.orderID,
        market: CONDITION,
        asset_id: TOKEN,
        side: "BUY",
        price: "0.5",
        size: "10",
        status: "CONFIRMED",
        match_time: expect.any(Number),
        owner: "test-api-key",
        maker_orders: [],
      },
    ]);
  });

  it("returns an empty list for an unknown trade id", async () => {
    const res = await env.app.inject({ method: "GET", url: "/clob/user-trades?id=nope" });
    expect(res.json()).toEqual([]);
  });
});

describe("cancelling", () => {
  it("releases the reserve and refuses to cancel twice", async () => {
    const placed = await placeOrder({ tokenID: TOKEN, side: "BUY", price: 0.4, size: 10 });
    const orderId = placed.orderID!;
    expect(await usdcBalance()).toBe(996);

    const first = await env.app.inject({
      method: "DELETE",
      url: "/clob/order",
      payload: { orderID: orderId },
    });
    expect(first.json()).toEqual({ canceled: [orderId], not_canceled: {}, success: true });
    expect(await usdcBalance()).toBe(1000);

    const second = await env.app.inject({
      method: "DELETE",
      url: "/clob/order",
      payload: { orderID: orderId },
    });
    expect(second.json()).toMatchObject({ canceled: [], success: false });
  });

  it("releases only the unmatched part of a partially filled order", async () => {
    const placed = await placeOrder({ tokenID: TOKEN, side: "BUY", price: 0.5, size: 10 });
    await recordTrade(TOKEN, "SELL", 0.49, 4);
    await env.matchOnce();

    await env.app.inject({
      method: "DELETE",
      url: "/clob/order",
      payload: { orderID: placed.orderID },
    });

    // Paid 2 USDC for 4 shares, the other 3 USDC came back out of the reserve.
    expect(await usdcBalance()).toBe(998);
    const wallet = await env.storage.wallet.getWallet();
    expect(wallet?.usdc_reserved).toBeCloseTo(0, 9);
    expect(await tokenBalance(TOKEN)).toBe(4);
  });

  it("gives shares back to the free balance", async () => {
    await env.storage.wallet.creditTokens(TOKEN, 20);
    const placed = await placeOrder({ tokenID: TOKEN, side: "SELL", price: 0.7, size: 10 });
    await env.app.inject({
      method: "DELETE",
      url: "/clob/order",
      payload: { orderID: placed.orderID },
    });
    expect(await tokenBalance(TOKEN)).toBe(20);
  });

  it("cancels everything at once", async () => {
    await placeOrder({ tokenID: TOKEN, side: "BUY", price: 0.4, size: 10 });
    await placeOrder({ tokenID: TOKEN, side: "BUY", price: 0.3, size: 10 });
    const res = await env.app.inject({ method: "POST", url: "/paper/orders/cancel-all" });
    expect((res.json() as { canceled: string[] }).canceled).toHaveLength(2);
    expect(await usdcBalance()).toBe(1000);
  });

  it("404s for an unknown order", async () => {
    expect((await getOrder("missing")).status).toBe(404);
  });
});

describe("market resolution", () => {
  it("cancels resting orders, then pays out winning shares", async () => {
    await placeOrder({ tokenID: TOKEN, side: "BUY", price: 0.4, size: 10 });
    await env.storage.wallet.creditTokens(TOKEN, 10);
    await env.storage.wallet.creditTokens(OTHER_TOKEN, 7);

    env.gateway.setMarket(CONDITION, {
      tokens: [
        { tokenId: TOKEN, outcome: "Yes", winner: true },
        { tokenId: OTHER_TOKEN, outcome: "No" },
      ],
    });

    // First pass frees the reserves; redemption waits for the next one.
    expect(await env.resolveOnce()).toEqual([]);
    expect(await usdcBalance()).toBe(1000);
    const orders = await env.app.inject({
      method: "GET",
      url: "/paper/orders?status=CANCELED_MARKET_RESOLVED",
    });
    expect(orders.json()).toHaveLength(1);

    expect(await env.resolveOnce()).toEqual([TOKEN, OTHER_TOKEN]);
    // 10 winning shares at $1; the 7 losing ones expire worthless.
    expect(await usdcBalance()).toBe(1010);
    expect(await tokenBalance(TOKEN)).toBe(0);

    const markets = (await env.app.inject({ method: "GET", url: "/paper/markets" })).json() as {
      closed: boolean;
      winningTokenId: string;
    }[];
    expect(markets[0]).toMatchObject({ closed: true, winningTokenId: TOKEN });
  });

  it("refuses new orders on a resolved market", async () => {
    await placeOrder({ tokenID: TOKEN, side: "BUY", price: 0.4, size: 10 });
    env.gateway.setMarket(CONDITION, {
      tokens: [
        { tokenId: TOKEN, outcome: "Yes", winner: true },
        { tokenId: OTHER_TOKEN, outcome: "No" },
      ],
    });
    await env.resolveOnce();
    await env.resolveOnce();

    const placed = await placeOrder({ tokenID: TOKEN, side: "BUY", price: 0.4, size: 10 });
    expect(placed.success).toBe(false);
    expect(placed.errorMsg).toMatch(/resolved/);
  });
});
