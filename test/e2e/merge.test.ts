import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { startTestEnv, type TestEnv } from "../helpers/env.js";

const TOKEN_YES = "token-yes";
const TOKEN_NO = "token-no";
const CONDITION = "cond-merge";

let env: TestEnv;

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

async function merge(body: Record<string, unknown>) {
  const res = await env.app.inject({
    method: "POST",
    url: "/clob/merge",
    payload: body,
  });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

beforeAll(async () => {
  env = await startTestEnv({ initialUsdc: 1000, instantTakerFill: false, docs: true });
  env.gateway.setBook(TOKEN_YES, {
    conditionId: CONDITION,
    asks: [[0.6, 50]],
    bids: [[0.4, 50]],
  });
  env.gateway.setBook(TOKEN_NO, {
    conditionId: CONDITION,
    asks: [[0.4, 50]],
    bids: [[0.6, 50]],
  });
  env.gateway.setMarket(CONDITION, {
    tokens: [
      { tokenId: TOKEN_YES, outcome: "Yes" },
      { tokenId: TOKEN_NO, outcome: "No" },
    ],
  });
});

afterAll(async () => {
  await env.close();
});

beforeEach(async () => {
  await env.resetState();
});

describe("POST /clob/merge", () => {
  it("merges max complementary free shares into USDC", async () => {
    await env.storage.wallet.creditTokens(TOKEN_YES, 10);
    await env.storage.wallet.creditTokens(TOKEN_NO, 7);

    const { status, body } = await merge({ conditionId: CONDITION, amount: "max" });
    expect(status).toBe(200);
    expect(body["transactionHash"]).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body["transactionId"]).toBeNull();

    expect(await usdcBalance()).toBe(1007);
    expect(await tokenBalance(TOKEN_YES)).toBe(3);
    expect(await tokenBalance(TOKEN_NO)).toBe(0);
  });

  it("merges an explicit amount when both legs cover it", async () => {
    await env.storage.wallet.creditTokens(TOKEN_YES, 10);
    await env.storage.wallet.creditTokens(TOKEN_NO, 10);

    const { status } = await merge({ conditionId: CONDITION, amount: 4 });
    expect(status).toBe(200);
    expect(await usdcBalance()).toBe(1004);
    expect(await tokenBalance(TOKEN_YES)).toBe(6);
    expect(await tokenBalance(TOKEN_NO)).toBe(6);
  });

  it("does not spend reserved shares", async () => {
    await env.storage.wallet.creditTokens(TOKEN_YES, 10);
    await env.storage.wallet.creditTokens(TOKEN_NO, 10);
    // Lock 8 Yes shares behind a resting SELL.
    await env.app.inject({
      method: "POST",
      url: "/clob/order",
      payload: { tokenID: TOKEN_YES, side: "SELL", price: 0.7, size: 8 },
    });

    const { status, body } = await merge({ conditionId: CONDITION, amount: "max" });
    expect(status).toBe(200);
    // Free Yes is 2, free No is 10 → merge 2.
    expect(await usdcBalance()).toBe(1002);
    expect(await tokenBalance(TOKEN_YES)).toBe(0);
    expect(await tokenBalance(TOKEN_NO)).toBe(8);
    expect(body["transactionHash"]).toMatch(/^0x/);
  });

  it("rejects when there is nothing complementary to merge", async () => {
    await env.storage.wallet.creditTokens(TOKEN_YES, 5);
    const { status, body } = await merge({ conditionId: CONDITION });
    expect(status).toBe(400);
    expect(body["error"]).toMatch(/insufficient complementary/i);
    expect(await usdcBalance()).toBe(1000);
  });

  it("rejects an amount larger than the shorter leg", async () => {
    await env.storage.wallet.creditTokens(TOKEN_YES, 3);
    await env.storage.wallet.creditTokens(TOKEN_NO, 10);
    const { status, body } = await merge({ conditionId: CONDITION, amount: 5 });
    expect(status).toBe(400);
    expect(body["error"]).toMatch(/insufficient complementary/i);
  });

  it("rejects Protocol V2 legs", async () => {
    const { status, body } = await merge({ legs: ["pos-1", "pos-2"], amount: "max" });
    expect(status).toBe(400);
    expect(body["error"]).toMatch(/legs/i);
  });

  it("rejects when both conditionId and legs are set", async () => {
    const { status, body } = await merge({
      conditionId: CONDITION,
      legs: ["pos-1"],
      amount: "max",
    });
    expect(status).toBe(400);
    expect(body["error"]).toMatch(/exactly one/i);
  });

  it("rejects when neither conditionId nor legs is set", async () => {
    const { status, body } = await merge({ amount: "max" });
    expect(status).toBe(400);
    expect(body["error"]).toMatch(/exactly one/i);
  });

  it("rejects an unknown market", async () => {
    const { status, body } = await merge({ conditionId: "no-such-market" });
    expect(status).toBe(400);
    expect(body["error"]).toMatch(/not found/i);
  });

  it("is documented in swagger", async () => {
    const res = await env.app.inject({ method: "GET", url: "/docs/json" });
    const paths = Object.keys((res.json() as { paths: Record<string, unknown> }).paths);
    expect(paths).toContain("/clob/merge");
  });
});
