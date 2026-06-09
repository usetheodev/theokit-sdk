import {
  BUILTIN_PRICING,
  createBudget,
  createUsdBudgetTracker,
  listBudgets,
  normalizeUsage,
  preflightCheck,
  snapshotAll,
} from "@theokit/sdk-budget";
import { createInMemoryMarkdownProvider } from "@theokit/sdk-memory";

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
