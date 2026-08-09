import { describe, expect, it } from "vitest";

/**
 * M93 T3.1 — the error path starts persisting the partial transcript.
 *
 * ## The defect, with exact evidence
 *
 * `runPostRunLifecycle` had a `catch` around `run.wait()` that called `flushSessionWrites()` and
 * **returned**. The comment said "the mutex still releases via the flushes below" — true, and
 * irrelevant: `persistTurnToTranscript` is called **only later in the same function**, and it is the **only
 * caller in the whole repository** (measured by grep). Nothing had been queued, so the flush
 * drained an **empty** set.
 *
 * A 429 after eight tool calls destroyed the turn **leaving nothing on disk**. Combined with the
 * absent retry on the single-key path — M93's other half — the loss was total: the turn
 * failed, was not retried, and left no trace to resume from.
 *
 * ## Why the test checks STRUCTURE and does not drive the lifecycle
 *
 * `runPostRunLifecycle` requires a real `Run`, a `SessionStore`, a `hooksExecutor`, a `memoryGlue` and
 * a `memoryProvider` — assembling all of that in a unit test would rebuild half the runtime, and the
 * result would measure my double, not the code. The invariant that matters is directly checkable: the
 * `catch` calls `persistTurnToTranscript` **before** the `return`.
 *
 * It is a shape gate, and this says so rather than pretending it is behavioral. What makes it non-vacuous is the
 * order: it fails if the call leaves, and it fails if the call moves after the `return`.
 */
const source = (): string => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  return readFileSync(
    new URL("../src/internal/runtime/lifecycle/post-run-lifecycle.ts", import.meta.url),
    "utf8",
  );
};

/** The body of the `catch` wrapping `run.wait()`, up to the `return` that ends it. */
const catchBody = (): string => {
  const src = source();
  const i = src.indexOf("result = await run.wait();");
  const j = src.indexOf("return;", i);
  return src.slice(i, j);
};

describe("M93 — the error path persists the partial transcript", () => {
  it("the catch calls persistTurnToTranscript BEFORE the return", () => {
    expect(catchBody()).toContain("persistTurnToTranscript");
  });

  it("persists the run PARTIAL, not a reconstructed turn", () => {
    // `safeConversation(run)` returns what the turn actually produced — user + completed tool calls.
    // Reconstructing the rest would be inventing history, which is worse than the loss.
    expect(catchBody()).toContain("safeConversation(run)");
  });

  it("a write failure does NOT mask the turn error", () => {
    // The inner `catch` exists because the caller is waiting on the provider's error, not a disk
    // error on top of it (`error-handling.md`: cleanup does not propagate over the original error).
    const body = catchBody();
    expect(body).toContain("partial transcript write failed");
  });

  it("the flush still happens — the mutex still releases", () => {
    expect(catchBody()).toContain("flushSessionWrites()");
  });

  it("COUNTERPROOF — the SUCCESS path keeps its own persistence", () => {
    // The happy-path call was neither moved nor duplicated: there are two, one on each path.
    const occurrences = source().match(/persistTurnToTranscript\(/g) ?? [];
    expect(occurrences).toHaveLength(2);
  });
});
