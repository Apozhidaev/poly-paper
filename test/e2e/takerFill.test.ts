import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { startTestEnv, type TestEnv } from "../helpers/env.js";

const TOKEN = "token-yes";
const CONDITION = "cond-1";

let env: TestEnv;

async function placeOrder(body: Record<string, unknown>) {
  const res = await env.app.inject({ method: "POST", url: "/clob/order", payload: body });
  return res.json() as {
    ok: boolean;
    orderId?: string;
    status?: string;
    makingAmount?: string;
    takingAmount?: string;
    tradeIds?: string[];
    errorMsg?: string;
  };
}

beforeAll(async () => {
  env = await startTestEnv({ initialUsdc: 1000, instantTakerFill: true });
  env.gateway.setBook(TOKEN, {
    conditionId: CONDITION,
    asks: [
      [0.55, 5],
      [0.6, 10],
      [0.7, 100],
    ],
    bids: [[0.4, 8]],
  });
  env.gateway.setMarket(CONDITION, { tokens: [{ tokenId: TOKEN, outcome: "Yes" }] });
});

afterAll(async () => {
  await env.close();
});

beforeEach(async () => {
  await env.resetState();
});

describe("instant taker fill", () => {
  it("walks the book on placement and rests the remainder", async () => {
    const placed = await placeOrder({ tokenID: TOKEN, side: "BUY", price: 0.6, size: 20 });
    expect(placed).toMatchObject({
      ok: true,
      status: "live",
      // 5 @ 0.55 + 10 @ 0.60
      makingAmount: "8.75",
      takingAmount: "15",
    });
    expect(placed.tradeIds).toHaveLength(2);

    const order = (
      await env.app.inject({ method: "GET", url: `/clob/order/${placed.orderId}` })
    ).json() as Record<string, unknown>;
    // 5 shares at 0.55 and 10 at 0.60; the 0.70 level is above the limit.
    expect(order["size_matched"]).toBe("15");
    expect(order["status"]).toBe("LIVE");
    expect(order["associate_trades"]).toHaveLength(2);

    const trades = (
      await env.app.inject({ method: "GET", url: `/paper/orders/${placed.orderId}/trades` })
    ).json() as { price: number; size: number }[];
    expect(trades).toMatchObject([
      { price: 0.55, size: 5 },
      { price: 0.6, size: 10 },
    ]);

    const wallet = await env.storage.wallet.getWallet();
    // Reserved 12 at the limit, spent 2.75 + 6, and 3 stays locked for the resting 5 shares.
    expect(wallet?.usdc_available).toBeCloseTo(988.25, 6);
    expect(wallet?.usdc_reserved).toBeCloseTo(3, 6);
    expect(wallet?.tokens[TOKEN]).toBeCloseTo(15, 6);
  });

  it("sells into the bids at the bid price", async () => {
    await env.storage.wallet.creditTokens(TOKEN, 20);
    const placed = await placeOrder({ tokenID: TOKEN, side: "SELL", price: 0.4, size: 20 });
    expect(placed).toMatchObject({
      ok: true,
      status: "live",
      makingAmount: "8",
      takingAmount: "3.2",
    });

    const order = (
      await env.app.inject({ method: "GET", url: `/clob/order/${placed.orderId}` })
    ).json() as Record<string, unknown>;
    expect(order["size_matched"]).toBe("8");

    const wallet = await env.storage.wallet.getWallet();
    expect(wallet?.usdc_available).toBeCloseTo(1003.2, 6);
    expect(wallet?.tokens_reserved[TOKEN]).toBeCloseTo(12, 6);
  });

  it("leaves a non-crossing order untouched", async () => {
    const placed = await placeOrder({ tokenID: TOKEN, side: "BUY", price: 0.5, size: 10 });
    expect(placed).toMatchObject({
      ok: true,
      status: "live",
      makingAmount: "0",
      takingAmount: "0",
      tradeIds: [],
    });
    const order = (
      await env.app.inject({ method: "GET", url: `/clob/order/${placed.orderId}` })
    ).json() as Record<string, unknown>;
    expect(order["size_matched"]).toBe("0");
    expect(order["associate_trades"]).toEqual([]);
  });

  it("marks an order MATCHED when the book swallows it whole", async () => {
    const placed = await placeOrder({ tokenID: TOKEN, side: "BUY", price: 0.6, size: 10 });
    expect(placed).toMatchObject({
      ok: true,
      status: "matched",
      makingAmount: "5.75",
      takingAmount: "10",
    });
    expect(placed.tradeIds).toHaveLength(2);

    const order = (
      await env.app.inject({ method: "GET", url: `/clob/order/${placed.orderId}` })
    ).json() as Record<string, unknown>;
    expect(order["status"]).toBe("MATCHED");
    expect(order["size_matched"]).toBe("10");
  });
});
