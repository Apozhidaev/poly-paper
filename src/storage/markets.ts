import { cleanParams, collection } from "../mongo.js";
import { nowMs } from "../types.js";
import { COL_MARKET, type PaperMarketDocument } from "./types.js";

const markets = () => collection<PaperMarketDocument>(COL_MARKET);

/** Idempotent: the first order on a market registers it, later orders must not fail. */
export async function upsertMarket(doc: PaperMarketDocument): Promise<void> {
  await markets().updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true });
}

export async function getMarket(conditionId: string): Promise<PaperMarketDocument | null> {
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

export async function closeMarket(conditionId: string, winningTokenId: string): Promise<void> {
  await updateMarket(conditionId, {
    closed: true,
    winning_token_id: winningTokenId,
    closed_at: nowMs(),
  });
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

export async function findAllMarkets(): Promise<PaperMarketDocument[]> {
  return markets().find({}).toArray();
}
