import type { WalletDocument } from "../storage/types.js";

/** USDC has 6 decimals on chain; rounding writes keeps float dust out of the wallet. */
export function roundUsdc(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** Shares are quoted to two decimals on the CLOB. */
export function roundShares(value: number): number {
  return Math.round(value * 100) / 100;
}

export function notional(price: number, qty: number): number {
  return roundUsdc(price * qty);
}

export interface Position {
  assetId: string;
  free: number;
  reserved: number;
  total: number;
}

const DUST = 1e-6;

/** Zero and dust balances are hidden: `$inc` leaves keys behind that logically no longer exist. */
export function positions(wallet: WalletDocument): Position[] {
  const assetIds = new Set([
    ...Object.keys(wallet.tokens ?? {}),
    ...Object.keys(wallet.tokens_reserved ?? {}),
  ]);
  const result: Position[] = [];
  for (const assetId of assetIds) {
    const free = wallet.tokens[assetId] ?? 0;
    const reserved = wallet.tokens_reserved[assetId] ?? 0;
    const total = free + reserved;
    if (Math.abs(total) < DUST) continue;
    result.push({
      assetId,
      free: roundShares(free),
      reserved: roundShares(reserved),
      total: roundShares(total),
    });
  }
  return result.sort((a, b) => a.assetId.localeCompare(b.assetId));
}

export interface Equity {
  usdcAvailable: number;
  usdcReserved: number;
  positionsValue: number;
  total: number;
}

/** Mark-to-market: shares without a known mark price are valued at zero. */
export function equity(wallet: WalletDocument, marks: Map<string, number>): Equity {
  let positionsValue = 0;
  for (const position of positions(wallet)) {
    positionsValue += position.total * (marks.get(position.assetId) ?? 0);
  }
  return {
    usdcAvailable: roundUsdc(wallet.usdc_available),
    usdcReserved: roundUsdc(wallet.usdc_reserved),
    positionsValue: roundUsdc(positionsValue),
    total: roundUsdc(wallet.usdc_available + wallet.usdc_reserved + positionsValue),
  };
}
