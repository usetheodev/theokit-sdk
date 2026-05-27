/**
 * Phase 1 — RED tests for TokenUsage + CostBreakdown + Budget types
 * + BudgetExceededError + UnsupportedBudgetOperationError.
 */

import { describe, expect, it } from "vitest";

import { BudgetExceededError, UnsupportedBudgetOperationError } from "../../src/errors.js";
import type {
  BudgetMode,
  BudgetOptions,
  BudgetWindow,
  CostBreakdown,
  CostStatus,
  TokenUsage,
} from "../../src/types/index.js";

describe("TokenUsage — 5-bucket closed shape (D376)", () => {
  it("accepts all 5 buckets with totalTokens derived", () => {
    const u: TokenUsage = {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 200,
      cacheWriteTokens: 30,
      reasoningTokens: 10,
      totalTokens: 150,
    };
    expect(u.totalTokens).toBe(u.inputTokens + u.outputTokens);
  });

  it("EC-10 invariant: totalTokens === inputTokens + outputTokens", () => {
    const cases: Array<Pick<TokenUsage, "inputTokens" | "outputTokens">> = [
      { inputTokens: 0, outputTokens: 0 },
      { inputTokens: 1000, outputTokens: 500 },
      { inputTokens: 1, outputTokens: 1 },
    ];
    for (const c of cases) {
      const u: TokenUsage = { ...c, totalTokens: c.inputTokens + c.outputTokens };
      expect(u.totalTokens).toBe(u.inputTokens + u.outputTokens);
    }
  });

  it("cache fields optional", () => {
    const u: TokenUsage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
    expect(u.cacheReadTokens).toBeUndefined();
    expect(u.reasoningTokens).toBeUndefined();
  });

  it("requests[] populated for multi-call runs", () => {
    const u: TokenUsage = {
      inputTokens: 30,
      outputTokens: 15,
      totalTokens: 45,
      requests: [
        { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      ],
    };
    expect(u.requests?.length).toBe(3);
  });
});

describe("CostStatus — 4-value closed enum (D377)", () => {
  it("exhaustive switch over all 4 values", () => {
    function visit(s: CostStatus): string {
      switch (s) {
        case "actual":
          return "a";
        case "estimated":
          return "e";
        case "included":
          return "i";
        case "unknown":
          return "u";
        default: {
          const _never: never = s;
          throw new Error(`unreachable: ${_never as string}`);
        }
      }
    }
    expect(
      (["actual", "estimated", "included", "unknown"] as CostStatus[]).map(visit).join(""),
    ).toBe("aeiu");
  });

  it("CostBreakdown shape accepts undefined amountUsd when status is unknown", () => {
    const c: CostBreakdown = {
      amountUsd: undefined,
      status: "unknown",
      currency: "USD",
      source: "unknown",
      pricingVersion: undefined,
    };
    expect(c.amountUsd).toBeUndefined();
  });
});

describe("BudgetWindow — 5-value closed enum (D382)", () => {
  it("includes the documented 5 windows", () => {
    const all: BudgetWindow[] = ["1h", "1d", "1w", "30d", "365d"];
    expect(all.length).toBe(5);
  });
});

describe("BudgetMode — 3-value closed enum (D383)", () => {
  it("includes audit/warn/block", () => {
    const all: BudgetMode[] = ["audit", "warn", "block"];
    expect(all.length).toBe(3);
  });
});

describe("BudgetOptions shape", () => {
  it("compiles with minimal fields", () => {
    const o: BudgetOptions = {
      name: "ci-pipeline",
      scope: "process",
      limits: [{ window: "1d", limitUsd: 5.0 }],
    };
    expect(o.name).toBe("ci-pipeline");
  });

  it("compiles with all callbacks + multi-window stacked", () => {
    const o: BudgetOptions = {
      name: "agent-7",
      scope: "agent",
      limits: [
        { window: "1d", limitUsd: 1.0 },
        { window: "30d", limitUsd: 20.0 },
      ],
      mode: "block",
      onThreshold: async (e) => {
        void e;
      },
      onExceed: (e) => {
        void e;
      },
    };
    expect(o.limits.length).toBe(2);
  });
});

describe("BudgetExceededError (D386, EC-1)", () => {
  it("has code='budget_exceeded' + mode field (EC-1)", () => {
    const err = new BudgetExceededError({
      budgetName: "test",
      window: "1d",
      spentUsd: 5.5,
      limitUsd: 5.0,
      mode: "block",
    });
    expect(err.code).toBe("budget_exceeded");
    expect(err.budgetName).toBe("test");
    expect(err.window).toBe("1d");
    expect(err.spentUsd).toBe(5.5);
    expect(err.limitUsd).toBe(5.0);
    expect(err.mode).toBe("block");
    expect(err.name).toBe("BudgetExceededError");
  });

  it("EC-1: mode field is mandatory and persisted", () => {
    const audit = new BudgetExceededError({
      budgetName: "x",
      window: "1h",
      spentUsd: 1,
      limitUsd: 0.5,
      mode: "audit",
    });
    expect(audit.mode).toBe("audit");
  });
});

describe("UnsupportedBudgetOperationError (D388)", () => {
  it("has code='budget_op_unsupported'", () => {
    const err = new UnsupportedBudgetOperationError("send");
    expect(err.code).toBe("budget_op_unsupported");
    expect(err.operation).toBe("send");
    expect(err.name).toBe("UnsupportedBudgetOperationError");
  });
});
