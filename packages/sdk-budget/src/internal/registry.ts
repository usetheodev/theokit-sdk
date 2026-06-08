/**
 * Internal Budget registry — keeps live `BudgetOptions` per name.
 * Singleton; no persistence (D385).
 *
 * @internal
 */

import {
  type BudgetHandle,
  type BudgetMode,
  type BudgetOptions,
  type BudgetSnapshot,
  type BudgetWindow,
  ConfigurationError,
} from "@theokit/sdk";
import { spentIn } from "./ledger.js";

const NAME_GRAMMAR = /^[a-z0-9][a-z0-9_-]*$/;

const registry = new Map<string, BudgetOptions>();

export function __resetRegistryForTests(): void {
  registry.clear();
}

export function validateBudgetName(name: string): void {
  if (typeof name !== "string" || name.length === 0) {
    throw new ConfigurationError("Budget name must be a non-empty string", {
      code: "invalid_budget_name",
    });
  }
  if (!NAME_GRAMMAR.test(name)) {
    throw new ConfigurationError(
      `Budget name "${name}" must match ^[a-z0-9][a-z0-9_-]*$ (lowercase + dash/underscore, start alphanumeric)`,
      { code: "invalid_budget_name" },
    );
  }
}

export function createBudget(opts: BudgetOptions): BudgetHandle {
  // EC-7: name validation
  validateBudgetName(opts.name);
  if (registry.has(opts.name)) {
    // EC-16: duplicate throws (vs Task.submit idempotent return)
    throw new ConfigurationError(`Budget "${opts.name}" already exists`, {
      code: "invalid_budget_name",
    });
  }
  registry.set(opts.name, opts);
  return buildHandle(opts);
}

export function getBudget(name: string): BudgetHandle | undefined {
  const opts = registry.get(name);
  if (opts === undefined) return undefined;
  return buildHandle(opts);
}

export function listBudgets(): readonly BudgetHandle[] {
  return [...registry.values()].map(buildHandle);
}

export function deleteBudget(name: string): boolean {
  return registry.delete(name);
}

export function snapshotAll(): readonly BudgetSnapshot[] {
  const result: BudgetSnapshot[] = [];
  for (const opts of registry.values()) {
    for (const lim of opts.limits) {
      const spent = spentIn(opts.name, lim.window);
      result.push({
        name: opts.name,
        window: lim.window,
        spentUsd: spent,
        limitUsd: lim.limitUsd,
        ratio: lim.limitUsd > 0 ? spent / lim.limitUsd : 0,
      });
    }
  }
  return result;
}

export function getBudgetOptionsRaw(name: string): BudgetOptions | undefined {
  return registry.get(name);
}

export function defaultMode(opts: BudgetOptions): BudgetMode {
  return opts.mode ?? "warn";
}

function buildHandle(opts: BudgetOptions): BudgetHandle {
  return {
    name: opts.name,
    mode: defaultMode(opts),
    scope: opts.scope,
    limits: opts.limits,
    spentIn: (window: BudgetWindow) => spentIn(opts.name, window),
    remainingIn: (window: BudgetWindow) => {
      const lim = opts.limits.find((l) => l.window === window);
      if (lim === undefined) return Number.POSITIVE_INFINITY;
      return Math.max(0, lim.limitUsd - spentIn(opts.name, window));
    },
  };
}
