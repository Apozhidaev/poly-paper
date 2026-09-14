import { matchFromTradeEvents } from "../domain/matching.js";
import { getLogger } from "../logging.js";
import { applyFill } from "../service/fills.js";
import { orders, tradeEvents, EPS, type PaperOrderDocument } from "../storage/index.js";

const logger = getLogger();

/**
 * Matching is driven purely by observed trade events: each order keeps a cursor into the
 * event stream, so a tick only looks at what arrived since the last one. Fills are booked at
 * the order's own limit price, which is what a resting maker order would have got.
 */
async function matchOrder(order: PaperOrderDocument): Promise<void> {
  const oppositeSide = order.side === "BUY" ? "SELL" : "BUY";
  const events = await tradeEvents.findEventsAfter(
    order.asset_id,
    oppositeSide,
    order.cursor_event,
  );
  if (events.length === 0) return;

  const cursor = events[events.length - 1]?._id ?? null;
  const remaining = order.original_size - order.size_matched;
  const { fillQty } = matchFromTradeEvents({
    side: order.side,
    limitPrice: order.price,
    remaining,
    events,
  });

  if (fillQty <= EPS) {
    // Nothing qualified and nothing ever will, so skip past this batch for good.
    if (cursor !== null) await orders.advanceCursor(order._id, cursor);
    return;
  }

  await applyFill(order, { qty: fillQty, price: order.price, cursorEvent: cursor });
}

export async function matchOnce(): Promise<void> {
  const live = await orders.findLiveOrders();
  for (const order of live) {
    try {
      await matchOrder(order);
    } catch (exc) {
      logger.error("paper matcher: order failed", {
        order_id: order._id,
        error: String(exc),
      });
    }
  }
}
