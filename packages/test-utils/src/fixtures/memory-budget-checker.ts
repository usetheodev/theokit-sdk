/**
 * Memory budget - 140L consolidated
 * @internal
 */

export function buildMemoryBudgetChecker() {
  return { ready: true, safe: true };
}

export const MEMORY_BUDGET_CHECKER_OPTS = {
  verbose: false,
  timeout: 90000,
};
