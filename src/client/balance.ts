import { getExecutionPort } from "./execution.js";

export async function getUsdcBalance(): Promise<number> {
  return getExecutionPort().getUsdcBalance();
}

export async function getTokenBalance(tokenId: string): Promise<number> {
  return getExecutionPort().getTokenBalance(tokenId);
}
