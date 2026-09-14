import { equity, positions, roundShares, roundUsdc, type Equity, type Position } from "../domain/money.js";
import { getOrderbooksMap } from "../marketData/index.js";
import { settings } from "../settings.js";
import { wallet, type WalletDocument } from "../storage/index.js";
import { cancelAllOrders } from "./orders.js";

/**
 * Free USDC only, matching what the robot saw from `PaperExecution` before: money locked by
 * open orders must not look spendable.
 */
export async function usdcBalance(): Promise<number> {
  const doc = await wallet.getWallet();
  return roundUsdc(doc?.usdc_available ?? 0);
}

/** Free shares only, for the same reason. */
export async function tokenBalance(tokenId: string): Promise<number> {
  const doc = await wallet.getWallet();
  return roundShares(doc?.tokens[tokenId] ?? 0);
}

export interface WalletView {
  usdcAvailable: number;
  usdcReserved: number;
  positions: Position[];
}

export async function walletView(): Promise<WalletView> {
  const doc = await requireWallet();
  return {
    usdcAvailable: roundUsdc(doc.usdc_available),
    usdcReserved: roundUsdc(doc.usdc_reserved),
    positions: positions(doc),
  };
}

/** Mid price of each held asset, so positions can be marked without trusting a single side. */
async function markPrices(assetIds: string[]): Promise<Map<string, number>> {
  const marks = new Map<string, number>();
  if (assetIds.length === 0) return marks;
  const books = await getOrderbooksMap(assetIds);
  for (const [assetId, book] of books) {
    const bid = book.bids[0]?.price;
    const ask = book.asks[0]?.price;
    if (bid !== undefined && ask !== undefined) marks.set(assetId, (bid + ask) / 2);
    else if (bid !== undefined) marks.set(assetId, bid);
    else if (ask !== undefined) marks.set(assetId, ask);
  }
  return marks;
}

export interface PortfolioView extends Equity {
  positions: (Position & { markPrice: number | null; value: number })[];
  /** Change against the configured starting balance. */
  pnl: number;
}

export async function portfolio(): Promise<PortfolioView> {
  const doc = await requireWallet();
  const held = positions(doc);
  const marks = await markPrices(held.map((p) => p.assetId));
  const totals = equity(doc, marks);
  return {
    ...totals,
    positions: held.map((position) => {
      const mark = marks.get(position.assetId) ?? null;
      return {
        ...position,
        markPrice: mark,
        value: roundUsdc(position.total * (mark ?? 0)),
      };
    }),
    pnl: roundUsdc(totals.total - settings().paper.initialUsdc),
  };
}

export async function depositUsdc(amount: number): Promise<WalletView> {
  await wallet.depositUsdc(amount);
  return walletView();
}

/** Cancels open orders first, otherwise their reserves would be lost with the old wallet. */
export async function resetWallet(initialUsdc?: number): Promise<WalletView> {
  await cancelAllOrders();
  await wallet.resetWallet(initialUsdc ?? settings().paper.initialUsdc);
  return walletView();
}

async function requireWallet(): Promise<WalletDocument> {
  const doc = await wallet.getWallet();
  if (doc === null) throw new Error("paper wallet not initialized");
  return doc;
}
