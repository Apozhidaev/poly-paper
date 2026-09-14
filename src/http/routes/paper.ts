import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

import { gatewayUrl } from "../../marketData/index.js";
import { ping } from "../../mongo.js";
import * as orderService from "../../service/orders.js";
import * as walletService from "../../service/wallet.js";
import {
  markets,
  orders,
  trades,
  type PaperMarketDocument,
  type PaperOrderDocument,
  type PaperTradeDocument,
} from "../../storage/index.js";
import {
  cancelAllReply,
  depositBody,
  healthReply,
  listOrdersQuery,
  marketSchema,
  orderIdParams,
  paperOrderSchema,
  paperTradeSchema,
  portfolioReply,
  resetBody,
  walletReply,
} from "../schema.js";

function toPaperOrder(order: PaperOrderDocument) {
  return {
    orderId: order._id,
    status: order.status,
    side: order.side,
    assetId: order.asset_id,
    conditionId: order.condition_id,
    price: order.price,
    originalSize: order.original_size,
    sizeMatched: order.size_matched,
    createdAt: order.created_at,
    trades: order.associate_trades,
  };
}

function toPaperTrade(trade: PaperTradeDocument) {
  return {
    tradeId: trade.trade_id,
    orderId: trade.order_id,
    assetId: trade.asset_id,
    conditionId: trade.condition_id,
    side: trade.side,
    price: trade.avg_price,
    size: trade.matched_amount,
    matchTime: trade.match_time,
  };
}

function toPaperMarket(market: PaperMarketDocument) {
  return {
    conditionId: market._id,
    slug: market.slug,
    assetsIds: market.assets_ids,
    closed: market.closed,
    winningTokenId: market.winning_token_id ?? null,
    closedAt: market.closed_at ?? null,
  };
}

/** Everything outside the gateway contract: inspection and control of the paper wallet. */
export const paperRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/health",
    { schema: { tags: ["paper"], summary: "Liveness and Mongo reachability", response: { 200: healthReply } } },
    async () => {
      let mongoUp = true;
      try {
        await ping();
      } catch {
        mongoUp = false;
      }
      return {
        status: "ok" as const,
        mongo: mongoUp,
        upstream: gatewayUrl,
        orders: await orders.countByStatus(),
      };
    },
  );

  app.get(
    "/paper/wallet",
    { schema: { tags: ["paper"], summary: "Balances and positions", response: { 200: walletReply } } },
    async () => walletService.walletView(),
  );

  app.get(
    "/paper/portfolio",
    {
      schema: {
        tags: ["paper"],
        summary: "Mark-to-market equity and PnL against the starting balance",
        response: { 200: portfolioReply },
      },
    },
    async () => walletService.portfolio(),
  );

  app.post(
    "/paper/wallet/deposit",
    {
      schema: {
        tags: ["paper"],
        summary: "Add USDC to the wallet",
        body: depositBody,
        response: { 200: walletReply },
      },
    },
    async (request) => walletService.depositUsdc(request.body.usdc),
  );

  app.post(
    "/paper/wallet/reset",
    {
      schema: {
        tags: ["paper"],
        summary: "Cancel open orders and start from a clean wallet",
        body: resetBody,
        response: { 200: walletReply },
      },
    },
    async (request) => walletService.resetWallet(request.body.usdc),
  );

  app.get(
    "/paper/orders",
    {
      schema: {
        tags: ["paper"],
        summary: "List orders",
        querystring: listOrdersQuery,
        response: { 200: paperOrderSchema.array() },
      },
    },
    async (request) => {
      const { status, assetId, conditionId, limit } = request.query;
      const found = await orders.findOrders({ status, assetId, conditionId }, limit);
      return found.map(toPaperOrder);
    },
  );

  app.get(
    "/paper/orders/:orderID/trades",
    {
      schema: {
        tags: ["paper"],
        summary: "Fills of one order",
        params: orderIdParams,
        response: { 200: paperTradeSchema.array() },
      },
    },
    async (request) => {
      const found = await trades.findTradesByOrderId(request.params.orderID);
      return found.map(toPaperTrade);
    },
  );

  app.post(
    "/paper/orders/cancel-all",
    {
      schema: {
        tags: ["paper"],
        summary: "Cancel every live order",
        response: { 200: cancelAllReply },
      },
    },
    async () => ({ canceled: await orderService.cancelAllOrders() }),
  );

  app.get(
    "/paper/markets",
    {
      schema: {
        tags: ["paper"],
        summary: "Markets the service is tracking",
        response: { 200: marketSchema.array() },
      },
    },
    async () => (await markets.findAllMarkets()).map(toPaperMarket),
  );
};
