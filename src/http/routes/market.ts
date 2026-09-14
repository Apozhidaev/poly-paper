import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

import { polyGate } from "../../marketData/index.js";
import {
  conditionIdParams,
  errorReply,
  orderBookQuery,
  orderBooksBody,
  passthroughArray,
  passthroughObject,
} from "../schema.js";

/**
 * Market data is real, so these routes just forward to the upstream gateway. Responses are
 * passed through unchanged (no response schema) — the paper service must not become a place
 * where the CLOB payload silently loses fields.
 */
export const marketRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/clob/order-book",
    {
      schema: {
        tags: ["market"],
        summary: "Proxy: orderbook of one token",
        querystring: orderBookQuery,
        response: { 200: passthroughObject, 404: errorReply },
      },
    },
    async (request, reply) => {
      const book = await polyGate.orderBook(request.query.token_id);
      if (book === null) return reply.code(404).send({ error: "orderbook not found" });
      return book;
    },
  );

  app.post(
    "/clob/order-books",
    {
      schema: {
        tags: ["market"],
        summary: "Proxy: orderbooks in bulk",
        body: orderBooksBody,
        response: { 200: passthroughArray },
      },
    },
    async (request) => polyGate.orderBooks(request.body.map((item) => item.token_id)),
  );

  app.get(
    "/clob/markets/:conditionId",
    {
      schema: {
        tags: ["market"],
        summary: "Proxy: market by condition id",
        params: conditionIdParams,
        response: { 200: passthroughObject, 404: errorReply },
      },
    },
    async (request, reply) => {
      const market = await polyGate.market(request.params.conditionId);
      if (market === null) return reply.code(404).send({ error: "market not found" });
      return market;
    },
  );
};
