import { collection } from "../mongo.js";
import { COL_BALANCE, EPS, WALLET_ID, type WalletDocument } from "./types.js";

const balances = () => collection<WalletDocument>(COL_BALANCE);

function tokenKey(assetId: string): string {
  return `tokens.${assetId}`;
}

function reservedKey(assetId: string): string {
  return `tokens_reserved.${assetId}`;
}

function emptyWallet(initialUsdc: number): WalletDocument {
  return {
    _id: WALLET_ID,
    usdc_available: initialUsdc,
    usdc_reserved: 0,
    tokens: {},
    tokens_reserved: {},
  };
}

export async function ensureWallet(initialUsdc: number): Promise<WalletDocument> {
  const existing = await balances().findOne({ _id: WALLET_ID });
  if (existing !== null) return existing;
  const doc = emptyWallet(initialUsdc);
  await balances().insertOne(doc);
  return doc;
}

export async function getWallet(): Promise<WalletDocument | null> {
  return balances().findOne({ _id: WALLET_ID });
}

/** Wipes balances and positions; open orders are the caller's problem to cancel first. */
export async function resetWallet(initialUsdc: number): Promise<WalletDocument> {
  const doc = emptyWallet(initialUsdc);
  await balances().replaceOne({ _id: WALLET_ID }, doc, { upsert: true });
  return doc;
}

export async function depositUsdc(amount: number): Promise<void> {
  await balances().updateOne({ _id: WALLET_ID }, { $inc: { usdc_available: amount } });
}

/**
 * Every mutation below is a single guarded update rather than read-modify-write: HTTP
 * requests and the matcher tick run concurrently and would otherwise clobber each other.
 */
export async function tryReserveUsdc(cost: number): Promise<boolean> {
  const res = await balances().updateOne(
    { _id: WALLET_ID, usdc_available: { $gte: cost - EPS } },
    { $inc: { usdc_available: -cost, usdc_reserved: cost } },
  );
  return res.modifiedCount === 1;
}

export async function releaseUsdcReserve(cost: number): Promise<void> {
  await balances().updateOne(
    { _id: WALLET_ID },
    { $inc: { usdc_available: cost, usdc_reserved: -cost } },
  );
}

export async function tryReserveTokens(assetId: string, size: number): Promise<boolean> {
  const res = await balances().updateOne(
    { _id: WALLET_ID, [tokenKey(assetId)]: { $gte: size - EPS } },
    { $inc: { [tokenKey(assetId)]: -size, [reservedKey(assetId)]: size } },
  );
  return res.modifiedCount === 1;
}

export async function releaseTokenReserve(assetId: string, size: number): Promise<void> {
  await balances().updateOne(
    { _id: WALLET_ID },
    { $inc: { [tokenKey(assetId)]: size, [reservedKey(assetId)]: -size } },
  );
}

/**
 * Settle a BUY fill: drop `unlock` (reserved at the limit price) from the reserve, pay
 * `cost` (at the actual fill price) and credit the shares. The difference comes back as
 * available USDC, which is what makes a fill below the limit price profitable.
 */
export async function applyBuyFill(
  assetId: string,
  unlock: number,
  cost: number,
  qty: number,
): Promise<void> {
  await balances().updateOne(
    { _id: WALLET_ID },
    {
      $inc: {
        usdc_reserved: -unlock,
        usdc_available: unlock - cost,
        [tokenKey(assetId)]: qty,
      },
    },
  );
}

/** Settle a SELL fill: the reserved shares are gone, the proceeds land as available USDC. */
export async function applySellFill(
  assetId: string,
  qty: number,
  proceeds: number,
): Promise<void> {
  await balances().updateOne(
    { _id: WALLET_ID },
    { $inc: { [reservedKey(assetId)]: -qty, usdc_available: proceeds } },
  );
}

export async function creditTokens(assetId: string, qty: number): Promise<void> {
  await balances().updateOne({ _id: WALLET_ID }, { $inc: { [tokenKey(assetId)]: qty } });
}

/**
 * $1 USDC per winning share; clears every outcome token of the market, free and reserved.
 * Called by the resolver only, after all live orders on the market are cancelled.
 */
export async function redeemOutcomeTokens(
  outcomeTokenIds: string[],
  winningTokenId: string,
): Promise<number> {
  const wallet = await getWallet();
  if (wallet === null) throw new Error("paper wallet not initialized");

  let payout = 0;
  const unset: Record<string, ""> = {};
  for (const tokenId of outcomeTokenIds) {
    const free = wallet.tokens[tokenId] ?? 0;
    const reserved = wallet.tokens_reserved[tokenId] ?? 0;
    if (tokenId === winningTokenId) payout += free + reserved;
    unset[tokenKey(tokenId)] = "";
    unset[reservedKey(tokenId)] = "";
  }

  await balances().updateOne(
    { _id: WALLET_ID },
    { $inc: { usdc_available: payout }, $unset: unset },
  );
  return payout;
}
