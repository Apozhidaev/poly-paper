import type { Side } from "../types.js";

export interface OrderRequest {
  tokenId: string;
  side: Side;
  price: number;
  size: number;
}

export interface OrderConstraints {
  tickSize: number;
  minOrderSize: number;
}

/** Tick multiples are checked with a tolerance: 0.03 / 0.01 is 2.9999999999999996 in floats. */
function isTickMultiple(price: number, tickSize: number): boolean {
  if (tickSize <= 0) return true;
  const ticks = price / tickSize;
  return Math.abs(ticks - Math.round(ticks)) < 1e-6;
}

/**
 * Rejection reason, or null when the order is acceptable. The CLOB refuses these before the
 * order ever reaches the book, so the paper service has to as well or strategies will look
 * profitable on orders that could never exist.
 */
export function validateOrder(
  request: OrderRequest,
  constraints: OrderConstraints,
): string | null {
  const { side, price, size } = request;

  if (side !== "BUY" && side !== "SELL") return `invalid side: ${String(side)}`;
  if (!Number.isFinite(price)) return "price is not a number";
  if (price <= 0 || price >= 1) return `price out of range (0, 1): ${price}`;
  if (!isTickMultiple(price, constraints.tickSize)) {
    return `price ${price} is not a multiple of tick size ${constraints.tickSize}`;
  }
  if (!Number.isFinite(size)) return "size is not a number";
  if (size <= 0) return `size must be positive: ${size}`;
  if (size < constraints.minOrderSize) {
    return `size ${size} below minimum order size ${constraints.minOrderSize}`;
  }
  return null;
}
