import { z } from "zod";

export const sideSchema = z.enum(["BUY", "SELL"]);

/** Payload the robot already sends: `tickSize`/`negRisk`/`orderType` are accepted for
 * compatibility but ignored — the live orderbook is the authority on tick and min size. */
export const postOrderBody = z.object({
  tokenID: z.string().min(1),
  side: sideSchema,
  price: z.coerce.number(),
  size: z.coerce.number(),
  tickSize: z.union([z.string(), z.number()]).optional(),
  negRisk: z.boolean().optional(),
  orderType: z.string().optional(),
});

export const postOrderReply = z.object({
  orderID: z.string().optional(),
  success: z.boolean(),
  errorMsg: z.string().optional(),
});

export const cancelOrderBody = z.object({
  orderID: z.string().min(1),
});

export const cancelOrderReply = z.object({
  canceled: z.array(z.string()),
  not_canceled: z.record(z.string()),
  success: z.boolean(),
});

export const orderIdParams = z.object({
  orderID: z.string().min(1),
});

export const clobOrderReply = z.object({
  id: z.string(),
  status: z.string(),
  market: z.string(),
  asset_id: z.string(),
  side: sideSchema,
  price: z.string(),
  original_size: z.string(),
  size_matched: z.string(),
  created_at: z.number(),
  associate_trades: z.array(z.string()),
  type: z.string(),
  owner: z.string(),
});

export const clobTradeReply = z.object({
  id: z.string(),
  taker_order_id: z.string(),
  market: z.string(),
  asset_id: z.string(),
  side: sideSchema,
  price: z.string(),
  size: z.string(),
  status: z.string(),
  match_time: z.number(),
  owner: z.string(),
  maker_orders: z.array(z.unknown()),
});

export const userTradesQuery = z.object({
  id: z.string().min(1),
});

export const tokenBalanceQuery = z.object({
  token_id: z.string().min(1),
});

export const balanceReply = z.object({
  balance: z.number(),
});

export const orderBookQuery = z.object({
  token_id: z.string().min(1),
});

export const orderBooksBody = z.array(z.object({ token_id: z.string().min(1) }));

export const conditionIdParams = z.object({
  conditionId: z.string().min(1),
});

export const errorReply = z.object({
  error: z.string(),
});

/** Upstream payloads are documented as free-form objects so proxying cannot drop fields. */
export const passthroughObject = z.record(z.unknown());
export const passthroughArray = z.array(passthroughObject);

const positionSchema = z.object({
  assetId: z.string(),
  free: z.number(),
  reserved: z.number(),
  total: z.number(),
});

export const walletReply = z.object({
  usdcAvailable: z.number(),
  usdcReserved: z.number(),
  positions: z.array(positionSchema),
});

export const portfolioReply = z.object({
  usdcAvailable: z.number(),
  usdcReserved: z.number(),
  positionsValue: z.number(),
  total: z.number(),
  pnl: z.number(),
  positions: z.array(
    positionSchema.extend({
      markPrice: z.number().nullable(),
      value: z.number(),
    }),
  ),
});

export const depositBody = z.object({
  usdc: z.number().positive(),
});

export const resetBody = z.object({
  usdc: z.number().nonnegative().optional(),
});

export const listOrdersQuery = z.object({
  status: z.enum(["LIVE", "MATCHED", "CANCELED", "CANCELED_MARKET_RESOLVED", "INVALID"]).optional(),
  assetId: z.string().optional(),
  conditionId: z.string().optional(),
  limit: z.coerce.number().int().positive().max(1000).default(200),
});

export const paperOrderSchema = z.object({
  orderId: z.string(),
  status: z.string(),
  side: sideSchema,
  assetId: z.string(),
  conditionId: z.string(),
  price: z.number(),
  originalSize: z.number(),
  sizeMatched: z.number(),
  createdAt: z.number(),
  trades: z.array(z.string()),
});

export const paperTradeSchema = z.object({
  tradeId: z.string(),
  orderId: z.string(),
  assetId: z.string(),
  conditionId: z.string(),
  side: sideSchema,
  price: z.number(),
  size: z.number(),
  matchTime: z.number(),
});

export const cancelAllReply = z.object({
  canceled: z.array(z.string()),
});

export const marketSchema = z.object({
  conditionId: z.string(),
  slug: z.string(),
  assetsIds: z.array(z.string()),
  closed: z.boolean(),
  winningTokenId: z.string().nullable(),
  closedAt: z.number().nullable(),
});

export const healthReply = z.object({
  status: z.literal("ok"),
  mongo: z.boolean(),
  upstream: z.string(),
  orders: z.record(z.number()),
});
