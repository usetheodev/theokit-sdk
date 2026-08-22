/**
 * Integration tests for the physically-extracted Budget internals
 * (SDK 2.0 Phase 2 / iter 18+ — ADR-008).
 *
 * Validates that the 5 sources moved from sdk-core to
 * `packages/sdk-budget/src/internal/` (calendar-window, ledger,
 * normalize-usage, registry, enforcement) function end-to-end via
 * the new `@theokit/sdk-budget` exports.
 *
 * The moved sources consume sdk-core utilities (BudgetExceededError,
 * ConfigurationError, withCwdMutex per ADR-008, types). Cross-package
 * import chain MUST work without re-introducing the kernel → extension
 * direction violation.
 */

import {
  charge,
  chargeAndCheckThresholds,
  createBudget,
  defaultMode,
  deleteBudget,
  getBudget,
  inferApiMode,
  listBudgets,
  normalizeUsage,
  preflightCheck,
  snapshotAll,
  spentIn,
  startOfDayUtc,
  startOfWeekUtc,
  windowStartMs,
} from "@theokit/sdk-budget";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("@theokit/sdk-budget extracted internals (Phase 2 iter 18+ — ADR-008)", () => {
  afterEach(() => {
    // Clean up the singleton registry between tests.
    for (const handle of listBudgets()) {
      deleteBudget(handle.name);
    }
  });

  describe("calendar-window helpers", () => {
    it("test_startOfDayUtc_returns_midnight_UTC", () => {
      const now = new Date("2026-06-08T15:30:45.123Z");
      const start = startOfDayUtc(now);
      expect(start.toISOString()).toBe("2026-06-08T00:00:00.000Z");
    });

    it("test_startOfWeekUtc_returns_monday", () => {
      // 2026-06-08 is a Monday — week start IS this date.
      const monday = new Date("2026-06-08T12:00:00.000Z");
      expect(startOfWeekUtc(monday).toISOString()).toBe("2026-06-08T00:00:00.000Z");
      // 2026-06-10 is a Wednesday — week start is 2026-06-08.
      const wed = new Date("2026-06-10T12:00:00.000Z");
      expect(startOfWeekUtc(wed).toISOString()).toBe("2026-06-08T00:00:00.000Z");
    });

    it("test_windowStartMs_returns_correct_anchor_per_window", () => {
      const now = new Date("2026-06-08T12:00:00.000Z");
      const oneH = windowStartMs("1h", now);
      const oneD = windowStartMs("1d", now);
      // 1h before noon = 11:00
      expect(new Date(oneH).toISOString()).toBe("2026-06-08T11:00:00.000Z");
      // 1d = midnight UTC of same day
      expect(new Date(oneD).toISOString()).toBe("2026-06-08T00:00:00.000Z");
    });
  });

  describe("ledger basic charge + spent semantics", () => {
    it("test_charge_then_spentIn_returns_charged_amount", async () => {
      await charge("test-budget-A", 1.5);
      await charge("test-budget-A", 2.25);
      const total = spentIn("test-budget-A", "1d");
      expect(total).toBeCloseTo(3.75, 6);
    });

    it("test_charge_isolates_by_budget_name", async () => {
      await charge("budget-X", 10);
      await charge("budget-Y", 5);
      expect(spentIn("budget-X", "1d")).toBeCloseTo(10, 6);
      expect(spentIn("budget-Y", "1d")).toBeCloseTo(5, 6);
    });
  });

  describe("normalize-usage shape mapping", () => {
    it("test_inferApiMode_picks_correct_shape_per_provider", () => {
      expect(inferApiMode("anthropic")).toBe("anthropic_messages");
      expect(inferApiMode("openai")).toBe("openai_chat_completions");
    });

    it("test_normalizeUsage_anthropic_shape_extracts_buckets", () => {
      const usage = normalizeUsage(
        {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 20,
          cache_creation_input_tokens: 10,
        },
        { provider: "anthropic" },
      );
      expect(usage.inputTokens).toBe(100);
      expect(usage.outputTokens).toBe(50);
      expect(usage.cacheReadTokens).toBe(20);
      expect(usage.cacheWriteTokens).toBe(10);
    });

    it("test_normalizeUsage_openai_chat_shape", () => {
      const usage = normalizeUsage(
        {
          prompt_tokens: 100,
          completion_tokens: 50,
        },
        { provider: "openai" },
      );
      expect(usage.inputTokens).toBe(100);
      expect(usage.outputTokens).toBe(50);
    });
  });

  describe("registry lifecycle (create / get / list / delete / snapshot)", () => {
    it("test_createBudget_registers_named_budget", () => {
      const handle = createBudget({
        name: "test-budget-1",
        scope: "process" as const,
        limits: [{ window: "1d", limitUsd: 1 }],
      });
      expect(handle.name).toBe("test-budget-1");
      expect(getBudget("test-budget-1")).toBeDefined();
    });

    it("test_listBudgets_returns_all_active", () => {
      createBudget({
        name: "b1",
        scope: "process" as const,
        limits: [{ window: "1d", limitUsd: 1 }],
      });
      createBudget({
        name: "b2",
        scope: "process" as const,
        limits: [{ window: "1d", limitUsd: 2 }],
      });
      const list = listBudgets();
      expect(list.length).toBe(2);
      const names = list.map((b) => b.name).sort();
      expect(names).toEqual(["b1", "b2"]);
    });

    it("test_deleteBudget_returns_true_when_existed", () => {
      createBudget({
        name: "to-delete",
        scope: "process" as const,
        limits: [{ window: "1d", limitUsd: 1 }],
      });
      expect(deleteBudget("to-delete")).toBe(true);
      expect(deleteBudget("to-delete")).toBe(false); // already gone
    });

    it("test_snapshotAll_returns_per_window_state", async () => {
      createBudget({
        name: "snap-test",
        scope: "process" as const,
        limits: [{ window: "1d", limitUsd: 10 }],
      });
      await charge("snap-test", 3);
      const snaps = snapshotAll();
      const entry = snaps.find((s) => s.name === "snap-test");
      expect(entry).toBeDefined();
      expect(entry?.spentUsd).toBeCloseTo(3, 6);
      expect(entry?.limitUsd).toBe(10);
    });

    it("test_defaultMode_returns_warn_when_unspecified", () => {
      const opts = {
        name: "x",
        scope: "process" as const,
        limits: [{ window: "1d" as const, limitUsd: 1 }],
      };
      expect(defaultMode(opts)).toBe("warn");
    });
  });

  describe("enforcement (preflight + threshold callbacks)", () => {
    it("test_preflightCheck_does_not_throw_under_limit", () => {
      createBudget({
        name: "block-test",
        scope: "process" as const,
        mode: "block",
        limits: [{ window: "1d", limitUsd: 10 }],
      });
      expect(() => preflightCheck("block-test", 2)).not.toThrow();
    });

    it("test_preflightCheck_throws_when_estimate_would_exceed_block_limit", async () => {
      createBudget({
        name: "block-fail",
        scope: "process" as const,
        mode: "block",
        limits: [{ window: "1d", limitUsd: 1 }],
      });
      await charge("block-fail", 0.95);
      expect(() => preflightCheck("block-fail", 0.5)).toThrow(/Budget/i);
    });

    it("test_chargeAndCheckThresholds_records_charge_and_invokes_callback", async () => {
      const onExceed = vi.fn();
      // `onExceed` is at BudgetOptions top level (NOT per-limit) — fires
      // at 100% of ANY limit per the dispatchExceed implementation.
      createBudget({
        name: "callback-test",
        scope: "process" as const,
        mode: "warn",
        limits: [{ window: "1d", limitUsd: 1 }],
        onExceed,
      } as Parameters<typeof createBudget>[0]);
      await chargeAndCheckThresholds("callback-test", 1.5);
      expect(onExceed).toHaveBeenCalledTimes(1);
      const spent = spentIn("callback-test", "1d");
      expect(spent).toBeCloseTo(1.5, 6);
    });
  });
});
