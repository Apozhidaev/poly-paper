import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type Level = [price: number, size: number];

export interface BookFixture {
  conditionId: string;
  /** Best first: ascending asks, descending bids. Serialised in the CLOB's own order. */
  asks?: Level[];
  bids?: Level[];
  tickSize?: number;
  minOrderSize?: number;
}

export interface MarketFixture {
  slug?: string;
  tokens: { tokenId: string; outcome: string; price?: number; winner?: boolean }[];
}

/** The CLOB sends asks descending and bids ascending; `parseOrderbook` reverses both. */
function serializeLevels(levels: Level[], reverse: boolean): unknown[] {
  const ordered = reverse ? [...levels].reverse() : levels;
  return ordered.map(([price, size]) => ({ price: String(price), size: String(size) }));
}

function serializeBook(tokenId: string, fixture: BookFixture): unknown {
  return {
    asset_id: tokenId,
    market: fixture.conditionId,
    asks: serializeLevels(fixture.asks ?? [], true),
    bids: serializeLevels(fixture.bids ?? [], true),
    timestamp: String(Date.now()),
    min_order_size: String(fixture.minOrderSize ?? 5),
    tick_size: String(fixture.tickSize ?? 0.01),
    neg_risk: false,
  };
}

function serializeMarket(conditionId: string, fixture: MarketFixture): unknown {
  return {
    enable_order_book: true,
    active: true,
    closed: false,
    archived: false,
    accepting_orders: true,
    accepting_order_timestamp: null,
    minimum_order_size: 5,
    minimum_tick_size: 0.01,
    condition_id: conditionId,
    question_id: `q-${conditionId}`,
    question: "will it?",
    description: "",
    market_slug: fixture.slug ?? `slug-${conditionId}`,
    end_date_iso: null,
    game_start_time: null,
    seconds_delay: 0,
    fpmm: "",
    maker_base_fee: 0,
    taker_base_fee: 0,
    notifications_enabled: false,
    neg_risk: false,
    neg_risk_market_id: "",
    neg_risk_request_id: "",
    is_50_50_outcome: false,
    tokens: fixture.tokens.map((token) => ({
      token_id: token.tokenId,
      outcome: token.outcome,
      price: token.price ?? 0.5,
      winner: token.winner ?? false,
    })),
    tags: [],
  };
}

export interface FakeGateway {
  url: string;
  setBook(tokenId: string, fixture: BookFixture): void;
  removeBook(tokenId: string): void;
  setMarket(conditionId: string, fixture: MarketFixture): void;
  close(): Promise<void>;
}

/** Stands in for poly-gate so the real market-data client code is exercised end to end. */
export async function startFakeGateway(): Promise<FakeGateway> {
  const books = new Map<string, BookFixture>();
  const markets = new Map<string, MarketFixture>();

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (req.method === "GET" && url.pathname === "/clob/order-book") {
      const tokenId = url.searchParams.get("token_id") ?? "";
      const fixture = books.get(tokenId);
      if (fixture === undefined) return send(404, { error: "not found" });
      return send(200, serializeBook(tokenId, fixture));
    }

    if (req.method === "POST" && url.pathname === "/clob/order-books") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          token_id: string;
        }[];
        const result = parsed
          .filter((item) => books.has(item.token_id))
          .map((item) => serializeBook(item.token_id, books.get(item.token_id)!));
        send(200, result);
      });
      return undefined;
    }

    if (req.method === "GET" && url.pathname.startsWith("/clob/markets/")) {
      const conditionId = url.pathname.slice("/clob/markets/".length);
      const fixture = markets.get(conditionId);
      if (fixture === undefined) return send(404, { error: "not found" });
      return send(200, serializeMarket(conditionId, fixture));
    }

    return send(404, { error: "unhandled" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    setBook: (tokenId, fixture) => void books.set(tokenId, fixture),
    removeBook: (tokenId) => void books.delete(tokenId),
    setMarket: (conditionId, fixture) => void markets.set(conditionId, fixture),
    close: () => closeServer(server),
  };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
