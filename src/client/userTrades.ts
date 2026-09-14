import { getExecutionPort } from "./execution.js";
import type { UserTrade } from "./types.js";

export async function getUserTrades(tradeId: string): Promise<UserTrade[]> {
  return getExecutionPort().getUserTrades(tradeId);
}
