import { randomBytes } from "node:crypto";

import { roundShares } from "../domain/money.js";
import { getLogger } from "../logging.js";
import { getMarketByConditionId } from "../marketData/index.js";
import { EPS, markets, wallet } from "../storage/index.js";

const logger = getLogger();

export interface MergeRequest {
  conditionId?: string;
  legs?: string[];
  amount?: "max" | number;
}

export type MergeResult =
  | { ok: true; transactionHash: string; transactionId: null }
  | { ok: false; error: string };

function fakeTxHash(): string {
  return `0x${randomBytes(32).toString("hex")}`;
}

/** Resolve outcome token ids for a market, registering it if we only know it from upstream. */
async function resolveOutcomeTokens(conditionId: string): Promise<string[] | null> {
  const existing = await markets.getMarket(conditionId);
  if (existing !== null) {
    const ids = existing.assets_ids ?? [];
    return ids.length >= 2 ? ids : null;
  }

  const market = await getMarketByConditionId(conditionId);
  if (market === null) return null;

  const assetsIds = market.tokens.map((token) => token.tokenId);
  if (assetsIds.length < 2) return null;

  await markets.upsertMarket({
    _id: market.conditionId,
    slug: market.marketSlug,
    assets_ids: assetsIds,
    closed: false,
  });
  return assetsIds;
}

export async function mergePositions(request: MergeRequest): Promise<MergeResult> {
  const hasCondition =
    request.conditionId !== undefined && request.conditionId !== "";
  const hasLegs = request.legs !== undefined && request.legs.length > 0;

  if (hasCondition === hasLegs) {
    return {
      ok: false,
      error: "provide exactly one of conditionId or legs",
    };
  }
  if (hasLegs) {
    return {
      ok: false,
      error: "legs (Protocol V2 combo) are not supported in paper trading",
    };
  }

  const conditionId = request.conditionId!;
  const tokenIds = await resolveOutcomeTokens(conditionId);
  if (tokenIds === null) {
    return { ok: false, error: `market not found or not binary: ${conditionId}` };
  }

  const amountArg = request.amount ?? "max";
  let qty: number;
  if (amountArg === "max") {
    const doc = await wallet.getWallet();
    if (doc === null) return { ok: false, error: "paper wallet not initialized" };
    qty = Math.min(...tokenIds.map((id) => doc.tokens[id] ?? 0));
    qty = roundShares(qty);
  } else {
    if (!Number.isFinite(amountArg) || amountArg <= 0) {
      return { ok: false, error: "amount must be \"max\" or a positive number" };
    }
    qty = roundShares(amountArg);
  }

  if (qty <= EPS) {
    return { ok: false, error: "nothing to merge: insufficient complementary shares" };
  }

  if (!(await wallet.mergeCompleteSet(tokenIds, qty))) {
    return { ok: false, error: "insufficient complementary shares" };
  }

  const transactionHash = fakeTxHash();
  logger.info("paper merge", {
    condition_id: conditionId,
    amount: qty,
    transaction_hash: transactionHash,
  });

  return { ok: true, transactionHash, transactionId: null };
}
