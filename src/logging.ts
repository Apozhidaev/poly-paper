import { pino, type Logger as PinoLogger } from "pino";
import type { Db } from "mongodb";

import { getOr } from "./config.js";
import { connect } from "./mongo.js";

export type LogFields = Record<string, unknown>;
export type LogMethod = "debug" | "info" | "warning" | "error";

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warning(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  bind(fields: LogFields): Logger;
}

const PINO_LEVEL: Record<LogMethod, "debug" | "info" | "warn" | "error"> = {
  debug: "debug",
  info: "info",
  warning: "warn",
  error: "error",
};

let root: PinoLogger = createRoot("INFO");
let sinkDb: Db | null = null;

function createRoot(logLevel: string): PinoLogger {
  const level = logLevel.toLowerCase();
  const pretty = process.stdout.isTTY;
  return pino({
    level: PINO_LEVEL[level as LogMethod] ?? level,
    base: undefined,
    ...(pretty
      ? { transport: { target: "pino-pretty", options: { translateTime: "SYS:standard" } } }
      : {}),
  });
}

/** When `db` is set, every record except `debug` is also inserted into `db.log`. */
export function setupLogging(logLevel = "INFO", db: Db | null = null): void {
  sinkDb = db;
  root = createRoot(logLevel);
}

/** Entry points call this first: level from `log.level`, Mongo sink unless `log.mongo` is false. */
export function setupLoggingFromConfig(): void {
  setupLogging(getOr("log.level", "INFO"), getOr("log.mongo", true) ? connect() : null);
}

function writeToMongo(method: LogMethod, event: string, fields: LogFields): void {
  if (sinkDb === null || method === "debug") return;
  const doc = { timestamp: new Date(), method, event, ...fields };
  void sinkDb
    .collection("log")
    .insertOne(doc)
    .catch(() => undefined);
}

class BoundLogger implements Logger {
  constructor(private readonly bound: LogFields = {}) {}

  private write(method: LogMethod, event: string, fields?: LogFields): void {
    const merged = fields ? { ...this.bound, ...fields } : this.bound;
    root[PINO_LEVEL[method]](merged, event);
    writeToMongo(method, event, merged);
  }

  debug(event: string, fields?: LogFields): void {
    this.write("debug", event, fields);
  }

  info(event: string, fields?: LogFields): void {
    this.write("info", event, fields);
  }

  warning(event: string, fields?: LogFields): void {
    this.write("warning", event, fields);
  }

  error(event: string, fields?: LogFields): void {
    this.write("error", event, fields);
  }

  bind(fields: LogFields): Logger {
    return new BoundLogger({ ...this.bound, ...fields });
  }
}

export function getLogger(): Logger {
  return new BoundLogger();
}

export function logException(event: string, exc: unknown, fields: LogFields = {}): void {
  const exception = exc instanceof Error ? (exc.stack ?? exc.message) : String(exc);
  getLogger().error(event, { ...fields, exception });
}
