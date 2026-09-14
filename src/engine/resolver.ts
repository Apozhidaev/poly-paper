import { getLogger } from "../logging.js";
import { getMarketByConditionId } from "../marketData/index.js";
import { cancelOrder } from "../service/orders.js";
import { markets, orders, wallet } from "../storage/index.js";

const logger = getLogger();

/**
 * Settles markets that got a winning outcome: cancels whatever is still resting, pays $1 per
 * winning share and closes the market. Asset ids of settled markets are returned so the
 * caller can drop them from the WebSocket subscription.
 */
export async function resolveOnce(): Promise<string[]> {
  const settledAssetsIds: string[] = [];

  for (const marketDoc of await markets.findOpenMarkets()) {
    const conditionId = marketDoc._id;
    const market = await getMarketByConditionId(conditionId);
    if (market === null) {
      logger.error("paper resolver: market not found", { condition_id: conditionId });
      continue;
    }

    const winningTokenId = market.winningTokenId;
    if (winningTokenId === null) continue;

    // Cancelling frees the reserves; redemption waits for the next pass so it can count
    // everything the wallet holds in one go.
    const live = await orders.findLiveOrdersForCondition(conditionId);
    if (live.length > 0) {
      for (const order of live) {
        await cancelOrder(order._id, "CANCELED_MARKET_RESOLVED");
      }
      continue;
    }

    const assetsIds = marketDoc.assets_ids ?? [];
    const payout = await wallet.redeemOutcomeTokens(assetsIds, winningTokenId);
    await markets.closeMarket(conditionId, winningTokenId);
    settledAssetsIds.push(...assetsIds);

    logger.info("paper resolver: market settled", {
      condition_id: conditionId,
      winning_token: winningTokenId,
      credited_usdc: payout,
    });
  }

  return settledAssetsIds;
}
