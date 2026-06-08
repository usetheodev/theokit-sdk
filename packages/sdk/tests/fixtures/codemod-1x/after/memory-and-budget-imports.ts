import { createInMemoryMarkdownProvider } from "@theokit/sdk-memory";

import {
  createBudget,
  listBudgets,
  snapshotAll,
  preflightCheck,
  createUsdBudgetTracker,
  BUILTIN_PRICING,
  normalizeUsage,
} from "@theokit/sdk-budget";

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
