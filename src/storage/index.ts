import { collection } from "../mongo.js";
import {
  COL_MARKET,
  COL_ORDER,
  COL_TRADE,
  COL_TRADE_EVENT,
  type PaperMarketDocument,
  type PaperOrderDocument,
  type PaperTradeDocument,
  type PaperTradeEventDocument,
} from "./types.js";

export * from "./types.js";
export * as markets from "./markets.js";
export * as orders from "./orders.js";
export * as tradeEvents from "./tradeEvents.js";
export * as trades from "./trades.js";
export * as wallet from "./wallet.js";

export async function initIndexes(): Promise<void> {
  const orderCol = collection<PaperOrderDocument>(COL_ORDER);
  const marketCol = collection<PaperMarketDocument>(COL_MARKET);
  const tradeCol = collection<PaperTradeDocument>(COL_TRADE);
  const eventCol = collection<PaperTradeEventDocument>(COL_TRADE_EVENT);

  await orderCol.createIndex({ status: 1, asset_id: 1 });
  await orderCol.createIndex({ condition_id: 1, status: 1 });
  await orderCol.createIndex({ created_at: -1 });
  await marketCol.createIndex({ closed: 1 });
  await tradeCol.createIndex({ order_id: 1 });
  await tradeCol.createIndex({ trade_id: 1 }, { unique: true });
  await eventCol.createIndex({ asset_id: 1, side: 1, _id: 1 });
  await eventCol.createIndex({ timestamp: -1 });
}
