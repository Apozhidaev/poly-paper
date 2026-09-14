import { MongoClient, type Collection, type Db, type Document } from "mongodb";

import { getOr } from "./config.js";
import { removeNones } from "./utils/index.js";

export const DB_NAME = getOr("db.name", "testDb");
export const DB_URL = getOr("db.url", "mongodb://127.0.0.1:27017");

interface CounterDocument {
  _id: string;
  seq: number;
}

let client: MongoClient | null = null;

function getClient(): MongoClient {
  client ??= new MongoClient(DB_URL);
  return client;
}

export function connect(dbName: string = DB_NAME): Db {
  return getClient().db(dbName);
}

export function collection<T extends Document>(
  collectionName: string,
  dbName: string = DB_NAME,
): Collection<T> {
  return getClient().db(dbName).collection<T>(collectionName);
}

export async function close(): Promise<void> {
  if (client === null) return;
  const current = client;
  client = null;
  await current.close();
}

function counters(dbName: string): Collection<CounterDocument> {
  return getClient().db(dbName).collection<CounterDocument>("_counter");
}

export async function lastId(
  collectionName: string,
  dbName: string = DB_NAME,
): Promise<number | null> {
  const value = await counters(dbName).findOne({ _id: collectionName });
  return value ? value.seq : null;
}

export async function nextId(
  collectionName: string,
  dbName: string = DB_NAME,
): Promise<number> {
  const ret = await counters(dbName).findOneAndUpdate(
    { _id: collectionName },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  );
  if (ret === null) throw new Error(`next_id failed for ${collectionName}`);
  return ret.seq;
}

export function cleanParams<T extends Record<string, unknown>>(params: T): Partial<T> {
  return removeNones(params);
}
