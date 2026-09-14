import type { Side } from "../types.js";
import { LiveExecution } from "./liveExecution.js";
import type { ExecutionOrder, LimitOrderResult, UserTrade } from "./types.js";

export interface LimitOrderInput {
  tokenID: string;
  side: Side;
  price: number;
  size: number;
  tickSize: number;
  negRisk: boolean;
}

export interface ExecutionPort {
  getUsdcBalance(): Promise<number>;
  getTokenBalance(tokenId: string): Promise<number>;
  limitOrder(params: LimitOrderInput): Promise<LimitOrderResult>;
  cancelOrder(orderId: string): Promise<boolean>;
  getOrder(orderId: string): Promise<ExecutionOrder | null>;
  getUserTrades(tradeId: string): Promise<UserTrade[]>;
}

let override: ExecutionPort | null = null;
let singletonLive: LiveExecution | null = null;

export function getExecutionPort(): ExecutionPort {
  if (override !== null) return override;
  singletonLive ??= new LiveExecution();
  return singletonLive;
}

export function setExecutionPort(port: ExecutionPort | null): void {
  override = port;
}

export function resetExecutionPort(): void {
  override = null;
  singletonLive = null;
}
