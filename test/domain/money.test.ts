import { describe, expect, it } from "vitest";

import { equity, notional, positions, roundUsdc } from "../../src/domain/money.js";
import type { WalletDocument } from "../../src/storage/types.js";

function wallet(overrides: Partial<WalletDocument> = {}): WalletDocument {
  return {
    _id: "paper_wallet",
    usdc_available: 1000,
    usdc_reserved: 0,
    tokens: {},
    tokens_reserved: {},
    ...overrides,
  };
}

describe("notional", () => {
  it("rounds to USDC precision", () => {
    expect(notional(0.37, 3)).toBe(1.11);
    expect(notional(0.1, 0.3)).toBe(0.03);
  });
});

describe("roundUsdc", () => {
  it("keeps six decimals", () => {
    expect(roundUsdc(0.1 + 0.2)).toBe(0.3);
    expect(roundUsdc(1 / 3)).toBe(0.333333);
  });
});

describe("positions", () => {
  it("merges free and reserved shares", () => {
    const result = positions(
      wallet({ tokens: { a: 10 }, tokens_reserved: { a: 5, b: 2 } }),
    );
    expect(result).toEqual([
      { assetId: "a", free: 10, reserved: 5, total: 15 },
      { assetId: "b", free: 0, reserved: 2, total: 2 },
    ]);
  });

  it("hides keys left behind at zero by $inc", () => {
    expect(positions(wallet({ tokens: { a: 0 }, tokens_reserved: { a: 0 } }))).toEqual([]);
  });
});

describe("equity", () => {
  it("marks positions and sums the total", () => {
    const result = equity(
      wallet({ usdc_available: 100, usdc_reserved: 50, tokens: { a: 200 } }),
      new Map([["a", 0.25]]),
    );
    expect(result).toEqual({
      usdcAvailable: 100,
      usdcReserved: 50,
      positionsValue: 50,
      total: 200,
    });
  });

  it("values shares without a mark price at zero", () => {
    const result = equity(wallet({ usdc_available: 10, tokens: { a: 100 } }), new Map());
    expect(result.positionsValue).toBe(0);
    expect(result.total).toBe(10);
  });
});
