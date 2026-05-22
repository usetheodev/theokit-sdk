/**
 * Tests for retry policy: backoff, abort, non-retryable errors.
 */

import { describe, expect, it } from "vitest";

import { fn, Workflow } from "../../src/workflow.js";

describe("workflow retry policy", () => {
  it("succeeds on first attempt — no retry overhead", async () => {
    let calls = 0;
    const wf = Workflow.create({ name: "r-ok" })
      .then(fn("a", async () => { calls += 1; return "ok"; }, { retry: { maxAttempts: 3 } }))
      .commit();
    const run = await wf.run(undefined);
    expect(run.status).toBe("completed");
    expect(calls).toBe(1);
    expect(run.stepResults[0]?.attempts).toBe(1);
  });

  it("retries on transient failures up to maxAttempts", async () => {
    let calls = 0;
    const wf = Workflow.create({ name: "r-retry" })
      .then(fn("a", async () => {
        calls += 1;
        if (calls < 3) throw new Error("transient");
        return "eventually-ok";
      }, { retry: { maxAttempts: 3, initialBackoffMs: 1 } }))
      .commit();
    const run = await wf.run(undefined);
    expect(run.status).toBe("completed");
    expect(calls).toBe(3);
    expect(run.stepResults[0]?.attempts).toBe(3);
  });

  it("throws after maxAttempts exhausted", async () => {
    let calls = 0;
    const wf = Workflow.create({ name: "r-exhausted" })
      .then(fn("a", async () => {
        calls += 1;
        throw new Error("always-fail");
      }, { retry: { maxAttempts: 2, initialBackoffMs: 1 } }))
      .commit();
    const run = await wf.run(undefined);
    expect(run.status).toBe("failed");
    expect(calls).toBe(2);
    expect(run.error?.message).toBe("always-fail");
  });

  it("non-retryable errors propagate immediately", async () => {
    let calls = 0;
    class FatalError extends Error {
      override readonly name = "ConfigurationError";
    }
    const wf = Workflow.create({ name: "r-fatal" })
      .then(fn("a", async () => {
        calls += 1;
        throw new FatalError("bad config");
      }, { retry: { maxAttempts: 5, initialBackoffMs: 1 } }))
      .commit();
    const run = await wf.run(undefined);
    expect(run.status).toBe("failed");
    expect(calls).toBe(1); // no retries
  });
});
