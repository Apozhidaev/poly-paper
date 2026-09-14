export type ClobTickSize = "0.1" | "0.01" | "0.001" | "0.0001";

const ALLOWED: readonly ClobTickSize[] = ["0.1", "0.01", "0.001", "0.0001"];

/** Map the CLOB `minimum_tick_size` float to the tick-size string used in order payloads. */
export function clobTickSizeStr(minimumTickSize: number): ClobTickSize {
  for (const s of ALLOWED) {
    if (Math.abs(minimumTickSize - Number(s)) < 1e-15) return s;
  }
  throw new Error(`unsupported CLOB minimum_tick_size: ${minimumTickSize}`);
}
