import { getExecutionPort, type LimitOrderInput } from "./execution.js";
import type { ExecutionOrder, LimitOrderResult } from "./types.js";

export async function limitOrder(params: LimitOrderInput): Promise<LimitOrderResult> {
  return getExecutionPort().limitOrder(params);
}

export async function cancelOrder(orderId: string): Promise<boolean> {
  return getExecutionPort().cancelOrder(orderId);
}

export async function getOrder(orderId: string): Promise<ExecutionOrder | null> {
  return getExecutionPort().getOrder(orderId);
}
