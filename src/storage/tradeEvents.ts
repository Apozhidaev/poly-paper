import type { ObjectId } from "mongodb";

import { collection } from "../mongo.js";
import type { Side } from "../types.js";
import { COL_TRADE_EVENT, type PaperTradeEventDocument } from "./types.js";

const tradeEvents = () => collection<PaperTradeEventDocument>(COL_TRADE_EVENT);

export async function insertTradeEvent(event: PaperTradeEventDocument): Promise<ObjectId> {
  const res = await tradeEvents().insertOne(event);
  return res.insertedId;
}

/** Newest event overall, used to pin a fresh order's cursor to "everything from now on". */
export async function latestEventId(): Promise<ObjectId | null> {
  const doc = await tradeEvents().find({}).sort({ _id: -1 }).limit(1).next();
  return doc?._id ?? null;
}

/**
 * Events on `assetId` taken by `side`, newer than `after`. `_id` ordering doubles as
 * insertion order, which is what the matcher cursor relies on.
 */
export async function findEventsAfter(
  assetId: string,
  side: Side,
  after: ObjectId | null,
  limit = 1000,
): Promise<PaperTradeEventDocument[]> {
  const query: Record<string, unknown> = { asset_id: assetId, side };
  if (after !== null) query["_id"] = { $gt: after };
  return tradeEvents().find(query).sort({ _id: 1 }).limit(limit).toArray();
}
