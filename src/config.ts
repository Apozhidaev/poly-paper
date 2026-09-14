import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "yaml";

const CONFIG_FILE = "config.yaml";

let config: Record<string, unknown> = {};
let loaded = false;

function load(): void {
  if (loaded) return;
  loaded = true;
  let raw: string;
  try {
    raw = readFileSync(join(process.cwd(), CONFIG_FILE), "utf8");
  } catch {
    return;
  }
  // parse() returns null for an empty document, keep the "no config" shape instead.
  config = (parse(raw) as Record<string, unknown> | null) ?? {};
}

function resolve(setting: string): unknown {
  load();
  let current: unknown = config;
  for (const part of setting.split(".")) {
    if (typeof current === "object" && current !== null && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      throw new Error(`Config key not found: ${setting}`);
    }
  }
  return current;
}

export function get<T = unknown>(setting: string): T {
  return resolve(setting) as T;
}

export function has(setting: string): boolean {
  try {
    resolve(setting);
    return true;
  } catch {
    return false;
  }
}

export function getTry<T = unknown>(setting: string): T | null {
  return has(setting) ? (resolve(setting) as T) : null;
}

export function getOr<T>(setting: string, fallback: T): T {
  return has(setting) ? (resolve(setting) as T) : fallback;
}

/** Intervals are written in seconds in `config.yaml`; everything downstream works in milliseconds. */
export function getIntervalMs(setting: string, fallbackSeconds: number): number {
  return getOr(setting, fallbackSeconds) * 1000;
}
