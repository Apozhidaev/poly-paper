import { getOr } from "../config.js";
import { getLogger } from "../logging.js";

const logger = getLogger();

export const gatewayUrl = getOr("poly_gate.url", "http://localhost:8080");

type Json = Record<string, unknown>;

async function ensureOk(resp: Response, endpoint: string): Promise<void> {
  if (resp.ok) return;
  const body = await resp.text().catch(() => "");
  const detail = body === "" ? "" : ` - ${body.slice(0, 500)}`;
  throw new Error(`poly_gate ${endpoint}: HTTP ${resp.status} ${resp.statusText}${detail}`);
}

function expectObject(result: unknown, endpoint: string): Json {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    throw new Error(`poly_gate ${endpoint}: expected object, got ${typeof result}`);
  }
  return result as Json;
}

/**
 * Read-only client for the upstream gateway. The paper service emulates the trading side
 * itself, so only market-data endpoints are needed here — none of them require auth.
 */
export class PolyGateClient {
  private readonly base: string;

  constructor(baseUrl: string = gatewayUrl) {
    this.base = baseUrl.replace(/\/+$/, "");
  }

  /** GET /clob/order-book; null on 404 (no book for that token). */
  async orderBook(tokenId: string): Promise<Json | null> {
    const url = new URL(`${this.base}/clob/order-book`);
    url.searchParams.set("token_id", tokenId);
    const resp = await fetch(url);
    if (resp.status === 404) return null;
    await ensureOk(resp, "order_book");
    return expectObject(await resp.json(), "order_book");
  }

  /** GET /clob/markets/{condition_id}; null on 404. */
  async market(conditionId: string): Promise<Json | null> {
    const resp = await fetch(`${this.base}/clob/markets/${conditionId}`);
    if (resp.status === 404) return null;
    await ensureOk(resp, "market");
    return expectObject(await resp.json(), "market");
  }

  /** POST /clob/order-books; [] when the gateway is unreachable. */
  async orderBooks(tokenIds: string[]): Promise<Json[]> {
    if (tokenIds.length === 0) return [];
    try {
      const resp = await fetch(`${this.base}/clob/order-books`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tokenIds.map((t) => ({ token_id: t }))),
      });
      await ensureOk(resp, "order_books");
      const result: unknown = await resp.json();
      return Array.isArray(result) ? (result as Json[]) : [];
    } catch (exc) {
      logger.warning("poly_gate_order_books_failed", { error: String(exc) });
      return [];
    }
  }
}

export const polyGate = new PolyGateClient();
