// Fixture: iter 39 — verifies the codemod rewrites Memory + Budget
// symbol imports added to 1-x-to-2-0-map.json (createInMemoryMarkdownProvider
// → @theokit/sdk-memory; createUsdBudgetTracker + Budget facade primitives →
// @theokit/sdk-budget).

import {
  // Memory subsystem (new iter 39 map entry)
  createInMemoryMarkdownProvider,
  // Budget subsystem — registry
  createBudget,
  listBudgets,
  snapshotAll,
  // Budget subsystem — enforcement
  preflightCheck,
  // Budget subsystem — USD tracker
  createUsdBudgetTracker,
  BUILTIN_PRICING,
  // Budget subsystem — usage normalization
  normalizeUsage,
} from "@theokit/sdk";

export function buildProviders() {
  return {
    memoryProvider: createInMemoryMarkdownProvider(),
    budgetTracker: createUsdBudgetTracker({ maxUsd: 5 }),
  };
}

export function setupBudget() {
  const b = createBudget({
    name: "main",
    limits: [{ window: "1d", limitUsd: 10 }],
    scope: { kind: "global" },
  });
  preflightCheck("main", 0.5);
  return { budget: b, current: listBudgets(), snapshot: snapshotAll() };
}

export function normalize(raw: unknown) {
  return normalizeUsage(raw, { provider: "openai" });
}

export const pricing = BUILTIN_PRICING;
