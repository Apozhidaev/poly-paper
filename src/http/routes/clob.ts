import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

import * as orderService from "../../service/orders.js";
import * as walletService from "../../service/wallet.js";
import { toClobOrder, toClobTrade } from "../clobFormat.js";
import {
  balanceReply,
  cancelOrderBody,
  cancelOrderReply,
  clobOrderReply,
  errorReply,
  orderIdParams,
  postOrderBody,
  postOrderReply,
  tokenBalanceQuery,
  userTradesQuery,
  userTradesReply,
} from "../schema.js";

/** Emulated trading side of the CLOB, shaped exactly like the upstream gateway. */
export const clobRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/clob/order",
    {
      schema: {
        tags: ["clob"],
        summary: "Place a GTC limit order",
        body: postOrderBody,
        response: { 200: postOrderReply },
      },
    },
    async (request) => {
      const { tokenID, side, price, size } = request.body;
      const result = await orderService.placeOrder({ tokenId: tokenID, side, price, size });
      // A rejected order is a normal outcome, not a transport failure: the CLOB answers 200
      // with ok=false and so must we, or the robot sees an exception instead.
      if (!result.success) return { ok: false, errorMsg: result.errorMsg };
      return {
        ok: true,
        orderId: result.orderId,
        status: result.status.toLowerCase(),
        makingAmount: String(result.makingAmount),
        takingAmount: String(result.takingAmount),
        tradeIds: result.tradeIds,
        transactionsHashes: [],
      };
    },
  );

  app.delete(
    "/clob/order",
    {
      schema: {
        tags: ["clob"],
        summary: "Cancel a live order",
        body: cancelOrderBody,
        response: { 200: cancelOrderReply },
      },
    },
    async (request) => {
      const { orderID } = request.body;
      const canceled = await orderService.cancelOrder(orderID);
      if (canceled) return { canceled: [orderID], not_canceled: {}, success: true };
      return {
        canceled: [],
        not_canceled: { [orderID]: "order is not live" },
        success: false,
      };
    },
  );

  app.get(
    "/clob/order/:orderID",
    {
      schema: {
        tags: ["clob"],
        summary: "Get single order by id",
        params: orderIdParams,
        response: { 200: clobOrderReply, 404: errorReply },
      },
    },
    async (request, reply) => {
      const order = await orderService.getOrder(request.params.orderID);
      if (order === null) return reply.code(404).send({ error: "order not found" });
      return toClobOrder(order);
    },
  );

  app.get(
    "/clob/open-orders",
    {
      schema: {
        tags: ["clob"],
        summary: "Get open orders",
        description: "Returns the wallet's open orders.",
        response: { 200: clobOrderReply.array() },
      },
    },
    async () => (await orderService.listOpenOrders()).map(toClobOrder),
  );

  app.get(
    "/clob/user-trades",
    {
      schema: {
        tags: ["clob"],
        summary: "Get trades (authenticated user)",
        querystring: userTradesQuery,
        response: { 200: userTradesReply },
      },
    },
    async (request) => {
      const {
        id,
        maker_address: makerAddress,
        market,
        asset_id: assetId,
        before,
        after,
      } = request.query;
      const items = (
        await orderService.listTrades({ id, makerAddress, market, assetId, before, after })
      ).map(toClobTrade);
      return { items, has_more: false };
    },
  );

  app.get(
    "/clob/usdc-balance",
    {
      schema: {
        tags: ["clob"],
        summary: "Spendable USDC (reserves excluded)",
        response: { 200: balanceReply },
      },
    },
    async () => ({ balance: await walletService.usdcBalance() }),
  );

  app.get(
    "/clob/token-balance",
    {
      schema: {
        tags: ["clob"],
        summary: "Free shares of one outcome token (reserves excluded)",
        querystring: tokenBalanceQuery,
        response: { 200: balanceReply },
      },
    },
    async (request) => ({ balance: await walletService.tokenBalance(request.query.token_id) }),
  );
};
