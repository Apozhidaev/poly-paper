import { describe, expect, it } from "vitest";

import { matchFromTradeEvents, matchTaker, tradedThrough } from "../../src/domain/matching.js";
import type { OrderBook } from "../../src/types.js";

/** `asks` ascending and `bids` descending, the order `parseOrderbook` produces. */
function book(asks: [number, number][], bids: [number, number][]): OrderBook {
  return {
    assetId: "token-1",
    conditionId: "cond-1",
    timestamp: 0,
    asks: asks.map(([price, quantity]) => ({ price, quantity })),
    bids: bids.map(([price, quantity]) => ({ price, quantity })),
    minOrderSize: 5,
    tickSize: 0.01,
    negRisk: false,
  };
}

describe("tradedThrough", () => {
  it("requires the market to trade below a resting BUY", () => {
    expect(tradedThrough("BUY", 0.5, 0.49)).toBe(true);
    expect(tradedThrough("BUY", 0.5, 0.5)).toBe(false);
    expect(tradedThrough("BUY", 0.5, 0.51)).toBe(false);
  });

  it("requires the market to trade above a resting SELL", () => {
    expect(tradedThrough("SELL", 0.5, 0.51)).toBe(true);
    expect(tradedThrough("SELL", 0.5, 0.5)).toBe(false);
    expect(tradedThrough("SELL", 0.5, 0.49)).toBe(false);
  });
});

describe("matchFromTradeEvents", () => {
  it("ignores events that did not trade through the limit", () => {
    const match = matchFromTradeEvents({
      side: "BUY",
      limitPrice: 0.5,
      remaining: 10,
      events: [
        { price: 0.55, size: 100 },
        { price: 0.5, size: 100 },
      ],
    });
    expect(match.fillQty).toBe(0);
  });

  it("accumulates qualifying volume across events", () => {
    const match = matchFromTradeEvents({
      side: "BUY",
      limitPrice: 0.5,
      remaining: 10,
      events: [
        { price: 0.49, size: 4 },
        { price: 0.6, size: 50 },
        { price: 0.48, size: 3 },
      ],
    });
    expect(match.fillQty).toBe(7);
  });

  it("never fills more than what is left of the order", () => {
    const match = matchFromTradeEvents({
      side: "SELL",
      limitPrice: 0.5,
      remaining: 6,
      events: [{ price: 0.7, size: 1000 }],
    });
    expect(match.fillQty).toBe(6);
  });
});

describe("matchTaker", () => {
  it("walks the asks for a crossing BUY and stops at the limit", () => {
    const fills = matchTaker({
      side: "BUY",
      limitPrice: 0.6,
      size: 30,
      orderbook: book(
        [
          [0.55, 5],
          [0.6, 10],
          [0.62, 100],
        ],
        [],
      ),
    });
    expect(fills).toEqual([
      { price: 0.55, qty: 5 },
      { price: 0.6, qty: 10 },
    ]);
  });

  it("is capped by displayed depth", () => {
    const fills = matchTaker({
      side: "SELL",
      limitPrice: 0.4,
      size: 100,
      orderbook: book([], [[0.45, 12]]),
    });
    expect(fills).toEqual([{ price: 0.45, qty: 12 }]);
  });

  it("returns nothing when the book does not cross", () => {
    expect(
      matchTaker({ side: "BUY", limitPrice: 0.3, size: 10, orderbook: book([[0.5, 10]], []) }),
    ).toEqual([]);
  });

  it("fills at the limit itself, since that price crosses", () => {
    expect(
      matchTaker({ side: "BUY", limitPrice: 0.5, size: 10, orderbook: book([[0.5, 4]], []) }),
    ).toEqual([{ price: 0.5, qty: 4 }]);
  });
});
