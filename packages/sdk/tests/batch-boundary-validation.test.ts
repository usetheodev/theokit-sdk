/**
 * Boundary validation for Agent.batch (cross-val Gap 3, narrowed).
 *
 * batchImpl previously validated `concurrency` only incidentally via
 * Semaphore (leaky internal message, AND after wrapBatchAsTask — so an
 * invalid concurrency with `task` set registered a dangling Task before
 * throwing). Prompt items were never validated. This adds a pre-flight
 * `validateBatchInput` that fails fast with a typed ConfigurationError BEFORE
 * any side effect.
 */

import { describe, expect, it, vi } from "vitest";
import { ConfigurationError } from "../src/errors.js";
import { batchImpl, validateBatchInput } from "../src/internal/agent/batch.js";
import { list as taskRegistryList } from "../src/internal/task/registry.js";
import type { SDKAgent } from "../src/types/agent.js";
import type { BatchOptions } from "../src/types/batch.js";

const baseOptions: BatchOptions = {
  apiKey: "theo_test_batch",
  model: { id: "openai/gpt-4o-mini" },
  local: {},
};

function neverCreate(): Promise<SDKAgent> {
  throw new Error("deps.create must NOT be called on invalid input");
}

describe("validateBatchInput — concurrency", () => {
  it("test_validateBatchInput_rejects_zero_concurrency", () => {
    expect(() => validateBatchInput(["a"], { concurrency: 0 } as BatchOptions)).toThrowError(
      ConfigurationError,
    );
    try {
      validateBatchInput(["a"], { concurrency: 0 } as BatchOptions);
    } catch (e) {
      expect((e as ConfigurationError).code).toBe("invalid_concurrency");
      // user-facing message mentions concurrency, NOT internal "permits"/"semaphore"
      expect((e as Error).message.toLowerCase()).toContain("concurrency");
      expect((e as Error).message.toLowerCase()).not.toContain("permits");
    }
  });

  it("test_rejects_negative_noninteger_and_NaN_concurrency", () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => validateBatchInput(["a"], { concurrency: bad } as BatchOptions)).toThrowError(
        ConfigurationError,
      );
    }
  });

  it("test_accepts_omitted_and_valid_concurrency", () => {
    expect(() => validateBatchInput(["a"], {} as BatchOptions)).not.toThrow();
    expect(() => validateBatchInput(["a"], { concurrency: 4 } as BatchOptions)).not.toThrow();
  });
});

describe("validateBatchInput — prompt items", () => {
  it("test_rejects_empty_string_prompt", () => {
    expect(() => validateBatchInput([""], {} as BatchOptions)).toThrowError(ConfigurationError);
    try {
      validateBatchInput([""], {} as BatchOptions);
    } catch (e) {
      expect((e as ConfigurationError).code).toBe("invalid_batch_item");
    }
  });

  it("test_rejects_nonstring_prompt", () => {
    expect(() =>
      validateBatchInput([{ prompt: 123 as unknown as string }], {} as BatchOptions),
    ).toThrowError(ConfigurationError);
  });

  it("test_accepts_valid_string_and_BatchItem", () => {
    expect(() =>
      validateBatchInput(["hello", { prompt: "world" }], {} as BatchOptions),
    ).not.toThrow();
  });

  it("test_accepts_whitespace_prompt_not_content_linter", () => {
    // Whitespace-only is a non-empty string — structural validator does not
    // judge content (aligns with the repo's property-test contract).
    expect(() => validateBatchInput([{ prompt: "   " }], {} as BatchOptions)).not.toThrow();
  });
});

describe("batchImpl — pre-flight ordering (no side effects on invalid input)", () => {
  it("test_batch_invalid_concurrency_registers_no_task", async () => {
    const before = (await taskRegistryList()).length;
    await expect(
      batchImpl(
        ["a", "b"],
        { ...baseOptions, concurrency: 0, task: true },
        { create: neverCreate },
      ),
    ).rejects.toBeInstanceOf(ConfigurationError);
    // No dangling Task registered despite task:true.
    expect((await taskRegistryList()).length).toBe(before);
  });

  it("test_batch_empty_prompt_throws_before_create", async () => {
    const create = vi.fn(neverCreate);
    await expect(batchImpl(["ok", ""], baseOptions, { create })).rejects.toBeInstanceOf(
      ConfigurationError,
    );
    expect(create).not.toHaveBeenCalled();
  });
});
