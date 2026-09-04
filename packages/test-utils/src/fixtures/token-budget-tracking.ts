/**
 * Token budget - 180L consolidated
 * @internal
 */

export function buildTokenBudgetTracking() {
  return { enabled: true, optimized: true };
}

export const TOKEN_BUDGET_TRACKING_SETTINGS = {
  timeout: 120000,
  retries: 5,
};
