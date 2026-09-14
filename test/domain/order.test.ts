import { describe, expect, it } from "vitest";

import { validateOrder } from "../../src/domain/order.js";

const constraints = { tickSize: 0.01, minOrderSize: 5 };
const base = { tokenId: "token-1", side: "BUY" as const, price: 0.5, size: 10 };

describe("validateOrder", () => {
  it("accepts an order on the tick grid", () => {
    expect(validateOrder(base, constraints)).toBeNull();
    expect(validateOrder({ ...base, price: 0.03 }, constraints)).toBeNull();
    expect(validateOrder({ ...base, price: 0.99 }, constraints)).toBeNull();
  });

  it("rejects prices outside the (0, 1) range", () => {
    expect(validateOrder({ ...base, price: 0 }, constraints)).toMatch(/out of range/);
    expect(validateOrder({ ...base, price: 1 }, constraints)).toMatch(/out of range/);
    expect(validateOrder({ ...base, price: -0.5 }, constraints)).toMatch(/out of range/);
  });

  it("rejects prices off the tick grid", () => {
    expect(validateOrder({ ...base, price: 0.505 }, constraints)).toMatch(/tick size/);
    expect(validateOrder({ ...base, price: 0.5 }, { ...constraints, tickSize: 0.1 })).toBeNull();
    expect(
      validateOrder({ ...base, price: 0.55 }, { ...constraints, tickSize: 0.1 }),
    ).toMatch(/tick size/);
  });

  it("enforces the minimum order size", () => {
    expect(validateOrder({ ...base, size: 4.99 }, constraints)).toMatch(/minimum order size/);
    expect(validateOrder({ ...base, size: 5 }, constraints)).toBeNull();
    expect(validateOrder({ ...base, size: 0 }, constraints)).toMatch(/positive/);
  });

  it("rejects non-numeric input", () => {
    expect(validateOrder({ ...base, price: Number.NaN }, constraints)).toMatch(/not a number/);
    expect(validateOrder({ ...base, size: Number.NaN }, constraints)).toMatch(/not a number/);
  });
});
