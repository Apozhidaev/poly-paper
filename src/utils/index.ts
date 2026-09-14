export { Signal, sleep } from "./signal.js";

/** Drop `null`/`undefined` entries so Mongo `$set` never overwrites a field with nothing. */
export function removeNones<T extends Record<string, unknown>>(params: T): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) {
      result[key as keyof T] = value as T[keyof T];
    }
  }
  return result;
}
