import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";

import { getLogger } from "../logging.js";
import { settings } from "../settings.js";
import { clobRoutes } from "./routes/clob.js";
import { marketRoutes } from "./routes/market.js";
import { paperRoutes } from "./routes/paper.js";

const logger = getLogger();

export async function buildApp(): Promise<FastifyInstance> {
  // Pino is configured process-wide in logging.ts; Fastify keeps its own request log off.
  const app = Fastify({ logger: false });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply
        .code(400)
        .send({ error: "request validation failed", details: error.validation });
    }
    logger.error("http request failed", {
      method: request.method,
      url: request.url,
      error: String(error),
    });
    return reply.code(error.statusCode ?? 500).send({ error: error.message });
  });

  const docs = settings().docs;
  if (docs.enabled) {
    await app.register(fastifySwagger, {
      openapi: {
        info: {
          title: "poly-paper",
          description:
            "Paper-trading emulator for Polymarket. The /clob routes mirror the poly-gate " +
            "gateway (trading emulated, market data proxied upstream); /paper routes expose " +
            "the simulated wallet.",
          version: "0.1.0",
        },
        tags: [
          { name: "clob", description: "Emulated trading endpoints" },
          { name: "market", description: "Market data proxied to the upstream gateway" },
          { name: "paper", description: "Paper wallet inspection and control" },
        ],
      },
      transform: jsonSchemaTransform,
    });
    await app.register(fastifySwaggerUi, { routePrefix: docs.route });
  }

  await app.register(clobRoutes);
  await app.register(marketRoutes);
  await app.register(paperRoutes);

  return app;
}
