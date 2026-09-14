import { PaperEngine } from "./engine/index.js";
import { buildApp } from "./http/app.js";
import { getLogger, logException, setupLoggingFromConfig } from "./logging.js";
import { close as closeMongo, dbName, ping } from "./mongo.js";
import { settings } from "./settings.js";
import { initIndexes, wallet } from "./storage/index.js";

async function main(): Promise<void> {
  setupLoggingFromConfig();
  const logger = getLogger();
  const config = settings();

  await ping();
  await initIndexes();
  await wallet.ensureWallet(config.paper.initialUsdc);

  const engine = new PaperEngine();
  await engine.start();

  const app = await buildApp();
  await app.listen({ host: config.server.host, port: config.server.port });
  logger.info("poly-paper listening", {
    host: config.server.host,
    port: config.server.port,
    db: dbName(),
    docs: config.docs.enabled ? config.docs.route : null,
  });

  let stopping = false;
  const shutdown = (signal: string): void => {
    if (stopping) return;
    stopping = true;
    logger.info("poly-paper shutting down", { signal });
    void (async () => {
      try {
        await app.close();
        await engine.stop();
        await closeMongo();
      } catch (exc) {
        logException("shutdown_failed", exc);
      }
      process.exit(0);
    })();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((exc: unknown) => {
  logException("startup_failed", exc);
  process.exit(1);
});
