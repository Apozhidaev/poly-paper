import type { OrderStatus } from "./client";
import { cleanParams, collection } from "./mongo";
import type { Millis, Side } from "./types";

export const WALLET_ID = "paper_wallet";

export const COL_BALANCE = "_paper_balance";
export const COL_ORDER = "_paper_order";
export const COL_TRADE = "_paper_trade";
export const COL_MARKET = "_paper_market";
export const COL_TRADE_EVENT = "_paper_trade_event";

export interface WalletDocument {
  _id: string;
  usdc_available: number;
  usdc_reserved: number;
  tokens: Record<string, number>;
  tokens_reserved: Record<string, number>;
}

export interface PaperOrderDocument {
  _id: string;
  asset_id: string;
  side: Side;
  price: number;
  original_size: number;
  size_matched: number;
  status: OrderStatus;
  created_at: Millis;
  associate_trades: string[];
  condition_id: string;
}

export interface PaperMarketDocument {
  _id: string;
  slug: string;
  assets_ids: string[];
  closed: boolean;
  winning_token_id?: string;
  closed_at?: Millis;
}

export interface PaperTradeDocument {
  trade_id: string;
  order_id: string;
  asset_id: string;
  condition_id: string;
  avg_price: number;
  matched_amount: number;
  side: Side;
  match_time: Millis;
}

export interface PaperTradeEventDocument {
  condition_id: string;
  asset_id: string;
  price: number;
  size: number;
  side: Side;
  timestamp: Millis;
  transaction_hash: string;
}

const balances = () => collection<WalletDocument>(COL_BALANCE);
const orders = () => collection<PaperOrderDocument>(COL_ORDER);
const markets = () => collection<PaperMarketDocument>(COL_MARKET);
const trades = () => collection<PaperTradeDocument>(COL_TRADE);
const tradeEvents = () => collection<PaperTradeEventDocument>(COL_TRADE_EVENT);

export async function initIndexes(): Promise<void> {
  await orders().createIndex({ asset_id: 1 });
  await orders().createIndex({ status: 1 });
  await markets().createIndex({ closed: 1 });
  await trades().createIndex({ order_id: 1 });
  await trades().createIndex({ trade_id: 1, order_id: 1 }, { unique: true });
  await tradeEvents().createIndex({ condition_id: 1, timestamp: -1 });
  await tradeEvents().createIndex({ asset_id: 1, side: 1, timestamp: 1 });
}

export async function ensureWallet(initialUsdc: number): Promise<WalletDocument> {
  const existing = await balances().findOne({ _id: WALLET_ID });
  if (existing !== null) return existing;
  const doc: WalletDocument = {
    _id: WALLET_ID,
    usdc_available: initialUsdc,
    usdc_reserved: 0,
    tokens: {},
    tokens_reserved: {},
  };
  await balances().insertOne(doc);
  return doc;
}

export async function getWallet(): Promise<WalletDocument | null> {
  return balances().findOne({ _id: WALLET_ID });
}

export async function replaceWallet(doc: WalletDocument): Promise<void> {
  await balances().replaceOne({ _id: WALLET_ID }, doc);
}

export async function insertMarket(doc: PaperMarketDocument): Promise<void> {
  await markets().insertOne(doc);
}

export async function getMarketDoc(conditionId: string): Promise<PaperMarketDocument | null> {
  return markets().findOne({ _id: conditionId });
}

export async function updateMarket(
  conditionId: string,
  values: Partial<PaperMarketDocument>,
): Promise<void> {
  const set = cleanParams(values);
  if (Object.keys(set).length === 0) return;
  await markets().updateOne({ _id: conditionId }, { $set: set });
}

export async function closeMarket(
  conditionId: string,
  winningTokenId: string,
): Promise<void> {
  await updateMarket(conditionId, {
    closed: true,
    winning_token_id: winningTokenId,
    closed_at: Date.now(),
  });
}

export async function insertOrder(doc: PaperOrderDocument): Promise<void> {
  await orders().insertOne(doc);
}

export async function getOrderDoc(orderId: string): Promise<PaperOrderDocument | null> {
  return orders().findOne({ _id: orderId });
}

export async function updateOrder(
  orderId: string,
  values: Partial<PaperOrderDocument>,
): Promise<void> {
  const set = cleanParams(values);
  if (Object.keys(set).length === 0) return;
  await orders().updateOne({ _id: orderId }, { $set: set });
}

export async function findOpenMarkets(): Promise<PaperMarketDocument[]> {
  return markets().find({ closed: false }).toArray();
}

export async function findOpenMarketAssetsIds(): Promise<string[]> {
  const ids: string[] = [];
  for (const doc of await findOpenMarkets()) {
    ids.push(...(doc.assets_ids ?? []));
  }
  return ids;
}

export async function findLiveOrders(): Promise<PaperOrderDocument[]> {
  return orders().find({ status: "LIVE" }).toArray();
}

export async function findLiveOrdersForCondition(
  conditionId: string,
): Promise<PaperOrderDocument[]> {
  return orders().find({ status: "LIVE", condition_id: conditionId }).toArray();
}

export async function insertTradeEvent(event: PaperTradeEventDocument): Promise<void> {
  await tradeEvents().insertOne(event);
}

export async function findTradeEventsSince(
  assetId: string,
  side: Side,
  since: Millis,
): Promise<PaperTradeEventDocument[]> {
  return tradeEvents()
    .find({ asset_id: assetId, side, timestamp: { $gte: since } })
    .sort({ timestamp: 1 })
    .toArray();
}

export async function insertTrade(doc: PaperTradeDocument): Promise<void> {
  await trades().insertOne(doc);
}

export async function findTradeById(tradeId: string): Promise<PaperTradeDocument | null> {
  return trades().findOne({ trade_id: tradeId });
}

function tokensGet(map: Record<string, number> | undefined, key: string): number {
  if (map === undefined) return 0;
  return Number(map[key] ?? 0);
}

/** Zero balances are dropped rather than stored, so the wallet only lists what it holds. */
function tokensSet(map: Record<string, number>, key: string, value: number): void {
  if (value <= 0 && key in map) {
    delete map[key];
  } else if (value > 0) {
    map[key] = value;
  }
}

export async function tryReserveBuy(limitPrice: number, size: number): Promise<boolean> {
  const cost = limitPrice * size;
  const wallet = await getWallet();
  if (wallet === null) return false;
  if (wallet.usdc_available < cost) return false;
  wallet.usdc_available -= cost;
  wallet.usdc_reserved += cost;
  await replaceWallet(wallet);
  return true;
}

export async function releaseBuyReserve(limitPrice: number, size: number): Promise<void> {
  const cost = limitPrice * size;
  const wallet = await getWallet();
  if (wallet === null) return;
  wallet.usdc_reserved -= cost;
  wallet.usdc_available += cost;
  await replaceWallet(wallet);
}

export async function tryReserveSell(assetId: string, size: number): Promise<boolean> {
  const wallet = await getWallet();
  if (wallet === null) return false;
  const available = tokensGet(wallet.tokens, assetId);
  if (available < size) return false;
  const tokens = { ...wallet.tokens };
  const reserved = { ...wallet.tokens_reserved };
  tokensSet(tokens, assetId, available - size);
  tokensSet(reserved, assetId, tokensGet(reserved, assetId) + size);
  wallet.tokens = tokens;
  wallet.tokens_reserved = reserved;
  await replaceWallet(wallet);
  return true;
}

export async function releaseSellReserve(assetId: string, size: number): Promise<void> {
  const wallet = await getWallet();
  if (wallet === null) return;
  const tokens = { ...wallet.tokens };
  const reserved = { ...wallet.tokens_reserved };
  const locked = tokensGet(reserved, assetId);
  const move = Math.min(locked, size);
  tokensSet(reserved, assetId, locked - move);
  tokensSet(tokens, assetId, tokensGet(tokens, assetId) + move);
  wallet.tokens = tokens;
  wallet.tokens_reserved = reserved;
  await replaceWallet(wallet);
}

/** Unlock the reserve for `fillQty` at the limit price; pay the actual fill price. */
export async function applyBuyFill(
  limitPrice: number,
  fillQty: number,
  fillPrice: number,
): Promise<void> {
  const wallet = await getWallet();
  if (wallet === null) return;
  const unlock = limitPrice * fillQty;
  const pay = fillPrice * fillQty;
  wallet.usdc_reserved -= unlock;
  wallet.usdc_available += unlock - pay;
  await replaceWallet(wallet);
}

export async function applySellFill(
  assetId: string,
  fillQty: number,
  fillPrice: number,
): Promise<void> {
  const wallet = await getWallet();
  if (wallet === null) return;
  const reserved = { ...wallet.tokens_reserved };
  const locked = tokensGet(reserved, assetId);
  const move = Math.min(locked, fillQty);
  tokensSet(reserved, assetId, locked - move);
  wallet.tokens_reserved = reserved;
  wallet.usdc_available += fillPrice * move;
  await replaceWallet(wallet);
}

export async function creditTokens(assetId: string, qty: number): Promise<void> {
  const wallet = await getWallet();
  if (wallet === null) return;
  const tokens = { ...wallet.tokens };
  tokensSet(tokens, assetId, tokensGet(tokens, assetId) + qty);
  wallet.tokens = tokens;
  await replaceWallet(wallet);
}

/** $1 USDC per winning share; clears all outcome token balances (free and reserved). */
export async function redeemOutcomeTokens(
  outcomeTokenIds: string[],
  winningTokenId: string,
): Promise<number> {
  const wallet = await getWallet();
  if (wallet === null) throw new Error("paper wallet not initialized");
  const tokens = { ...wallet.tokens };
  const reserved = { ...wallet.tokens_reserved };
  let payout = 0;
  for (const tid of outcomeTokenIds) {
    const amount = tokensGet(tokens, tid) + tokensGet(reserved, tid);
    if (tid === winningTokenId) payout += amount;
    tokensSet(tokens, tid, 0);
    tokensSet(reserved, tid, 0);
  }
  wallet.tokens = tokens;
  wallet.tokens_reserved = reserved;
  wallet.usdc_available += payout;
  await replaceWallet(wallet);
  return payout;
}
