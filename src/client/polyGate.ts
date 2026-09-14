import { getOr } from "../config.js";
import { getLogger } from "../logging.js";

const logger = getLogger();

export const gatewayUrl = getOr("poly_gate.url", "http://localhost:8080");
export const gatewayToken = getOr("poly_gate.token", "");

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

export class PolyGateClient {
  private readonly base: string;

  constructor(baseUrl: string = gatewayUrl) {
    this.base = baseUrl.replace(/\/+$/, "");
  }

  private authHeaders(): Record<string, string> {
    if (gatewayToken === "") {
      throw new Error("Missing poly_gate.token in config.yaml (see config_example.yaml).");
    }
    return { Authorization: `Bearer ${gatewayToken}` };
  }

  private static balanceFromResponse(result: unknown, endpoint: string): number {
    if (typeof result === "number") return result;
    if (typeof result === "object" && result !== null) {
      const balance = (result as Json)["balance"];
      if (balance !== null && balance !== undefined) return Number(balance);
    }
    throw new Error(
      `poly_gate ${endpoint}: expected balance number or object with balance, got ${typeof result}`,
    );
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

  /** GET /clob/usdc-balance; human-readable USDC. */
  async usdcBalance(): Promise<number> {
    const resp = await fetch(`${this.base}/clob/usdc-balance`, { headers: this.authHeaders() });
    await ensureOk(resp, "usdc_balance");
    return PolyGateClient.balanceFromResponse(await resp.json(), "usdc_balance");
  }

  /** GET /clob/token-balance; human-readable shares. */
  async tokenBalance(tokenId: string): Promise<number> {
    const url = new URL(`${this.base}/clob/token-balance`);
    url.searchParams.set("token_id", tokenId);
    const resp = await fetch(url, { headers: this.authHeaders() });
    await ensureOk(resp, "token_balance");
    return PolyGateClient.balanceFromResponse(await resp.json(), "token_balance");
  }

  /** POST /clob/order. */
  async postOrder(payload: Json): Promise<Json> {
    const resp = await fetch(`${this.base}/clob/order`, {
      method: "POST",
      headers: { ...this.authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    await ensureOk(resp, "post_order");
    return expectObject(await resp.json(), "post_order");
  }

  /** DELETE /clob/order. */
  async cancelOrder(orderId: string): Promise<Json> {
    const resp = await fetch(`${this.base}/clob/order`, {
      method: "DELETE",
      headers: { ...this.authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ orderID: orderId }),
    });
    await ensureOk(resp, "cancel_order");
    return expectObject(await resp.json(), "cancel_order");
  }

  /** GET /clob/order/{orderID}; null on 404. */
  async order(orderId: string): Promise<Json | null> {
    const resp = await fetch(`${this.base}/clob/order/${orderId}`, {
      headers: this.authHeaders(),
    });
    if (resp.status === 404) return null;
    await ensureOk(resp, "order");
    return expectObject(await resp.json(), "order");
  }

  /** GET /clob/user-trades?id=... */
  async userTrades(tradeId: string): Promise<Json[]> {
    const url = new URL(`${this.base}/clob/user-trades`);
    url.searchParams.set("id", tradeId);
    const resp = await fetch(url, { headers: this.authHeaders() });
    await ensureOk(resp, "user_trades");
    const result: unknown = await resp.json();
    if (result === null || result === undefined) return [];
    if (Array.isArray(result)) return result as Json[];
    if (typeof result === "object") return [result as Json];
    throw new Error(`poly_gate user_trades: expected array or object, got ${typeof result}`);
  }
}

export const polyGate = new PolyGateClient();
