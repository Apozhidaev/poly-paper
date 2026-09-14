import { MongoClient, type Collection, type Db, type Document } from "mongodb";

import { getOr } from "./config.js";
import { removeNones } from "./utils/index.js";

/** `MONGO_URL` / `MONGO_DB` override the config; tests point them at an in-memory server. */
const url = process.env["MONGO_URL"] ?? getOr("db.url", "mongodb://127.0.0.1:27017");
const name = process.env["MONGO_DB"] ?? getOr("db.name", "poly_paper");
let client: MongoClient | null = null;

export function dbName(): string {
  return name;
}

function getClient(): MongoClient {
  client ??= new MongoClient(url);
  return client;
}

export function connect(database: string = name): Db {
  return getClient().db(database);
}

export function collection<T extends Document>(
  collectionName: string,
  database: string = name,
): Collection<T> {
  return getClient().db(database).collection<T>(collectionName);
}

/** Fails fast at startup instead of on the first query. */
export async function ping(): Promise<void> {
  await connect().command({ ping: 1 });
}

export async function close(): Promise<void> {
  if (client === null) return;
  const current = client;
  client = null;
  await current.close();
}

export function cleanParams<T extends Record<string, unknown>>(params: T): Partial<T> {
  return removeNones(params);
}
