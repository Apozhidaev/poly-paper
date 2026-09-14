import type { ObjectId } from "mongodb";

import { collection } from "../mongo.js";
import type { OrderStatus } from "../types.js";
import { COL_ORDER, type PaperOrderDocument } from "./types.js";

const orders = () => collection<PaperOrderDocument>(COL_ORDER);

export async function insertOrder(doc: PaperOrderDocument): Promise<void> {
  await orders().insertOne(doc);
}

export async function getOrder(orderId: string): Promise<PaperOrderDocument | null> {
  return orders().findOne({ _id: orderId });
}

export async function findLiveOrders(): Promise<PaperOrderDocument[]> {
  return orders().find({ status: "LIVE" }).toArray();
}

export async function findLiveOrdersForCondition(
  conditionId: string,
): Promise<PaperOrderDocument[]> {
  return orders().find({ status: "LIVE", condition_id: conditionId }).toArray();
}

export async function findOrders(
  filter: { status?: OrderStatus; assetId?: string; conditionId?: string },
  limit = 200,
): Promise<PaperOrderDocument[]> {
  const query: Record<string, unknown> = {};
  if (filter.status !== undefined) query["status"] = filter.status;
  if (filter.assetId !== undefined) query["asset_id"] = filter.assetId;
  if (filter.conditionId !== undefined) query["condition_id"] = filter.conditionId;
  return orders().find(query).sort({ created_at: -1 }).limit(limit).toArray();
}

/**
 * Flip a LIVE order to a terminal status and hand back its pre-image. The status guard makes
 * this the single point where a cancellation wins, so the reserve is released exactly once
 * even if a cancel request and the resolver race.
 */
export async function takeLiveOrderForCancel(
  orderId: string,
  finalStatus: OrderStatus,
): Promise<PaperOrderDocument | null> {
  return orders().findOneAndUpdate(
    { _id: orderId, status: "LIVE" },
    { $set: { status: finalStatus } },
    { returnDocument: "before" },
  );
}

export interface FillUpdate {
  /** Optimistic guard: the fill applies only if nothing else moved `size_matched` meanwhile. */
  expectedSizeMatched: number;
  qty: number;
  tradeId: string;
  fullyMatched: boolean;
  cursorEvent: ObjectId | null;
}

export async function applyFill(orderId: string, update: FillUpdate): Promise<boolean> {
  const res = await orders().updateOne(
    { _id: orderId, status: "LIVE", size_matched: update.expectedSizeMatched },
    {
      $inc: { size_matched: update.qty },
      $push: { associate_trades: update.tradeId },
      $set: {
        cursor_event: update.cursorEvent,
        ...(update.fullyMatched ? { status: "MATCHED" as OrderStatus } : {}),
      },
    },
  );
  return res.modifiedCount === 1;
}

/** Events that could not match are skipped for good: the limit price never changes. */
export async function advanceCursor(orderId: string, cursorEvent: ObjectId): Promise<void> {
  await orders().updateOne(
    { _id: orderId, status: "LIVE" },
    { $set: { cursor_event: cursorEvent } },
  );
}

export async function countByStatus(): Promise<Record<string, number>> {
  const rows = await orders()
    .aggregate<{ _id: OrderStatus; count: number }>([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ])
    .toArray();
  return Object.fromEntries(rows.map((row) => [row._id, row.count]));
}
