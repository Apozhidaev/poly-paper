import { collection } from "../mongo.js";
import { COL_TRADE, type PaperTradeDocument } from "./types.js";

const trades = () => collection<PaperTradeDocument>(COL_TRADE);

export async function insertTrade(doc: PaperTradeDocument): Promise<void> {
  await trades().insertOne(doc);
}

export async function findTradeById(tradeId: string): Promise<PaperTradeDocument | null> {
  return trades().findOne({ trade_id: tradeId });
}

export async function findTradesByOrderId(orderId: string): Promise<PaperTradeDocument[]> {
  return trades().find({ order_id: orderId }).sort({ match_time: 1 }).toArray();
}
