import { getOr } from "./config.js";

export interface Settings {
  server: { host: string; port: number };
  docs: { enabled: boolean; route: string };
  paper: {
    initialUsdc: number;
    tickIntervalMs: number;
    manageIntervalMs: number;
    instantTakerFill: boolean;
  };
  /** Echoed as `owner` / `makerAddress` on CLOB payloads so the robot can match its own fills. */
  polymarket: { apiKey: string; makerAddress: string };
}

let cached: Settings | null = null;

export function settings(): Settings {
  cached ??= {
    server: {
      host: getOr("server.host", "0.0.0.0"),
      port: getOr("server.port", 8089),
    },
    docs: {
      enabled: getOr("docs.enabled", true),
      route: getOr("docs.route", "/docs"),
    },
    paper: {
      initialUsdc: getOr("paper.initial_usdc", 10_000),
      tickIntervalMs: getOr("paper.tick_interval", 1) * 1000,
      manageIntervalMs: getOr("paper.manage_interval", 600) * 1000,
      instantTakerFill: getOr("paper.instant_taker_fill", true),
    },
    polymarket: {
      apiKey: getOr("polymarket.api_key", ""),
      makerAddress: getOr("polymarket.maker_address", ""),
    },
  };
  return cached;
}
