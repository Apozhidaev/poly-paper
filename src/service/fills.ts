import { randomUUID } from "node:crypto";
import type { ObjectId } from "mongodb";

import { notional } from "../domain/money.js";
import { getLogger } from "../logging.js";
import { orders, trades, wallet, EPS, type PaperOrderDocument } from "../storage/index.js";
import { nowMs } from "../types.js";

const logger = getLogger();

export interface Fill {
  qty: number;
  price: number;
  /** Trade event the fill was derived from; advances the order's matcher cursor. */
  cursorEvent?: ObjectId | null;
}

export interface FillResult {
  applied: boolean;
  tradeId?: string;
  sizeMatched: number;
}

/**
 * Record one fill against a LIVE order and settle the wallet.
 *
 * The order document is flipped first, under an optimistic guard on `size_matched`: whoever
 * wins that update is the only one allowed to move money, which keeps a concurrent tick and
 * a placement from paying for the same fill twice.
 */
export async function applyFill(order: PaperOrderDocument, fill: Fill): Promise<FillResult> {
  const before = order.size_matched;
  const after = before + fill.qty;
  const fullyMatched = after >= order.original_size - EPS;
  const tradeId = randomUUID();

  const applied = await orders.applyFill(order._id, {
    expectedSizeMatched: before,
    qty: fill.qty,
    tradeId,
    fullyMatched,
    cursorEvent: fill.cursorEvent ?? order.cursor_event,
  });
  if (!applied) {
    logger.warning("paper fill: order changed under us, skipping", { order_id: order._id });
    return { applied: false, sizeMatched: before };
  }

  await trades.insertTrade({
    trade_id: tradeId,
    order_id: order._id,
    asset_id: order.asset_id,
    condition_id: order.condition_id,
    avg_price: fill.price,
    matched_amount: fill.qty,
    side: order.side,
    match_time: nowMs(),
  });

  if (order.side === "BUY") {
    // Telescoping unlock: the per-fill amounts always add up to the original reserve.
    const unlock = notional(order.price, after) - notional(order.price, before);
    await wallet.applyBuyFill(order.asset_id, unlock, notional(fill.price, fill.qty), fill.qty);
  } else {
    await wallet.applySellFill(order.asset_id, fill.qty, notional(fill.price, fill.qty));
  }

  logger.debug("paper fill", {
    order_id: order._id,
    side: order.side,
    qty: fill.qty,
    price: fill.price,
    fully_matched: fullyMatched,
  });

  return { applied: true, tradeId, sizeMatched: after };
}

/** Release whatever is still reserved for an order that will never fill further. */
export async function releaseRemainingReserve(order: PaperOrderDocument): Promise<void> {
  const remaining = order.original_size - order.size_matched;
  if (remaining <= EPS) return;
  if (order.side === "BUY") {
    const locked =
      notional(order.price, order.original_size) - notional(order.price, order.size_matched);
    await wallet.releaseUsdcReserve(locked);
  } else {
    await wallet.releaseTokenReserve(order.asset_id, remaining);
  }
}
