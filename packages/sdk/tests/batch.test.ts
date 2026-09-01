/**
 * Tests for batchImpl (T2.1, ADRs D134-D140).
 *
 * Uses fake agent factory via injected deps.create — no real LLM.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigurationError, type TheokitAgentError } from "../src/errors.js";
import { batchImpl } from "../src/internal/agent/batch.js";
import { currentCredentialPool } from "../src/internal/llm/credential-pool-context.js";
import type { AgentOptions, SDKAgent } from "../src/types/agent.js";
import type { BatchItem, BatchOptions, BatchResult } from "../src/types/batch.js";

type OnSendResult = { kind: "ok"; text: string } | Error;
interface FakeAgentScript {
  /** Per-call: 'ok'+text OR throw. */
  onSend: (prompt: string, options: AgentOptions) => OnSendResult | Promise<OnSendResult>;
  /** Optional dispose hook. */
  onDispose?: () => void;
}

function buildFakeFactory(script: FakeAgentScript): (options: AgentOptions) => Promise<SDKAgent> {
  return async (options: AgentOptions): Promise<SDKAgent> => {
    let disposed = false;
    const fake = {
      agentId: `fake-${Math.random().toString(16).slice(2)}`,
      model: options.model,
      options,
      async send(message: string | { text: string }) {
        const prompt = typeof message === "string" ? message : message.text;
        const verdict = await script.onSend(prompt, options);
        if (verdict instanceof Error) {
          return {
            wait: async () => {
              throw verdict;
            },
          };
        }
        return {
          wait: async () => ({
            id: `run-${Math.random().toString(16).slice(2)}`,
            status: "finished" as const,
            result: verdict.text,
            usage: { inputTokens: 1, outputTokens: 1 },
          }),
        };
      },
      close() {},
      async reload() {},
      async dispose() {
        if (disposed) return;
        disposed = true;
        script.onDispose?.();
      },
      async [Symbol.asyncDispose]() {
        await fake.dispose();
      },
      async listArtifacts() {
        return [];
      },
      async downloadArtifact(): Promise<Buffer> {
        throw new Error("not supported");
      },
    } as unknown as SDKAgent;
    return fake;
  };
}

const baseOptions: BatchOptions = {
  apiKey: "theo_test_batch",
  model: { id: "openai/gpt-4o-mini" },
  local: {},
};

describe("batchImpl (T2.1)", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("empty array returns empty (EC-1)", async () => {
    const results = await batchImpl([], baseOptions, {
      create: buildFakeFactory({ onSend: () => ({ kind: "ok", text: "x" }) }),
    });
    expect(results).toEqual([]);
  });

  it("runs all prompts in parallel", async () => {
    const create = buildFakeFactory({ onSend: (p) => ({ kind: "ok", text: `R:${p}` }) });
    const results = await batchImpl(["a", "b", "c"], baseOptions, { create });
    expect(results.length).toBe(3);
    expect(results.map((r) => r.ok && r.result.result)).toEqual(["R:a", "R:b", "R:c"]);
  });

  it("respects concurrency limit (sequential 1)", async () => {
    const order: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const create = buildFakeFactory({
      onSend: (p) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        order.push(`start:${p}`);
        return { kind: "ok", text: p };
      },
      onDispose: () => {
        inFlight -= 1;
      },
    });
    await batchImpl(["a", "b", "c"], { ...baseOptions, concurrency: 1 }, { create });
    expect(maxInFlight).toBe(1);
  });

  it("isolates failures per prompt (EC-4)", async () => {
    const create = buildFakeFactory({
      onSend: (p) => (p === "fail" ? new Error("boom") : { kind: "ok", text: `R:${p}` }),
    });
    const results = await batchImpl(["a", "fail", "c"], baseOptions, { create });
    expect(results[0]?.ok).toBe(true);
    expect(results[1]?.ok).toBe(false);
    expect(results[2]?.ok).toBe(true);
    expect((results[1] as { error: TheokitAgentError }).error.message).toContain("boom");
  });

  it("preserves input order when completions arrive out of order", async () => {
    // B-058. The interleaving this test needs was drawn from an unseeded `Math.random() * 20` on
    // every run: a draw that happens to be near-sorted exercises nothing, and a failure cannot be
    // replayed. Which interleaving happens is the *input* to the behaviour under test, so it is
    // pinned here instead of sampled.
    //
    // Each prompt now blocks on its own gate and completes only when this test opens it, so the
    // completion order is a fact rather than a probability. `completionOrder` is checked as an
    // assertion of its own — without it a fixture that quietly stopped blocking would leave the
    // order assertion passing on the trivial in-order case.
    //
    // With concurrency 3, a/b/c are in flight and d/e are queued: opening "c" frees the slot "d"
    // takes, opening "a" frees the slot "e" takes.
    const prompts = ["a", "b", "c", "d", "e"];
    const completionOrder = ["c", "a", "e", "b", "d"];
    const gates = new Map<string, { opened: Promise<void>; open: () => void }>(
      prompts.map((p) => {
        let open!: () => void;
        const opened = new Promise<void>((resolve) => {
          open = resolve;
        });
        return [p, { opened, open }];
      }),
    );
    let nextToOpen = 0;
    const openNext = (): void => {
      gates.get(completionOrder[nextToOpen++] ?? "")?.open();
    };

    const create = buildFakeFactory({
      onSend: async (p) => {
        await gates.get(p)?.opened;
        return { kind: "ok", text: p };
      },
    });
    const completed: string[] = [];

    openNext();
    const results = await batchImpl(
      prompts,
      {
        ...baseOptions,
        concurrency: 3,
        onResult: (r) => {
          completed.push(r.prompt);
          openNext();
        },
      },
      { create },
    );

    expect(completed, "the fixture must really have completed out of order").toEqual(
      completionOrder,
    );
    expect(
      results.map((r) => r.prompt),
      "results must follow INPUT order, not completion order",
    ).toEqual(prompts);
    expect(
      results.map((r) => r.index),
      "and each result must carry its input index",
    ).toEqual([0, 1, 2, 3, 4]);
  });

  it("calls onResult per completion", async () => {
    const create = buildFakeFactory({ onSend: (p) => ({ kind: "ok", text: p }) });
    const calls: BatchResult[] = [];
    await batchImpl(
      ["a", "b", "c"],
      {
        ...baseOptions,
        onResult: (r) => {
          calls.push(r);
        },
      },
      {
        create,
      },
    );
    expect(calls.length).toBe(3);
  });

  it("calls onProgress with running stats", async () => {
    const create = buildFakeFactory({ onSend: (p) => ({ kind: "ok", text: p }) });
    const snapshots: number[] = [];
    await batchImpl(
      ["a", "b", "c"],
      {
        ...baseOptions,
        onProgress: (p) => {
          snapshots.push(p.completed);
        },
      },
      { create },
    );
    expect(snapshots.length).toBe(3);
    expect(snapshots[snapshots.length - 1]).toBe(3);
  });

  it("caps concurrency to prompts.length (EC-3)", async () => {
    const create = buildFakeFactory({ onSend: (p) => ({ kind: "ok", text: p }) });
    // concurrency 100, only 2 prompts → no errors, all complete
    const results = await batchImpl(["a", "b"], { ...baseOptions, concurrency: 100 }, { create });
    expect(results.length).toBe(2);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("throws on invalid concurrency (EC-2)", async () => {
    const create = buildFakeFactory({ onSend: () => ({ kind: "ok", text: "x" }) });
    await expect(batchImpl(["a"], { ...baseOptions, concurrency: 0 }, { create })).rejects.toThrow(
      ConfigurationError,
    );
  });

  it("aborts pending on signal (EC-7)", async () => {
    let resolveFirst: (() => void) | undefined;
    const firstStarted = new Promise<void>((r) => {
      resolveFirst = r;
    });
    const create = buildFakeFactory({
      onSend: async () => {
        // First prompt blocks; we abort while it's in flight.
        resolveFirst?.();
        await new Promise((r) => setTimeout(r, 50));
        return { kind: "ok", text: "first" };
      },
    });
    const controller = new AbortController();
    const promise = batchImpl(
      ["a", "b", "c"],
      { ...baseOptions, concurrency: 1, signal: controller.signal },
      { create },
    );
    await firstStarted;
    controller.abort();
    const results = await promise;
    // First completes; subsequent get AbortError
    expect(results[0]?.ok).toBe(true);
    expect(results[1]?.ok).toBe(false);
    expect(results[2]?.ok).toBe(false);
  });

  it("onResult throw does not poison batch (EC-5)", async () => {
    const create = buildFakeFactory({ onSend: (p) => ({ kind: "ok", text: p }) });
    const stderr = vi.spyOn(process.stderr, "write");
    const results = await batchImpl(
      ["a", "b"],
      {
        ...baseOptions,
        onResult: () => {
          throw new Error("user callback broke");
        },
      },
      { create },
    );
    expect(results.length).toBe(2);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("user callback broke"));
    stderr.mockRestore();
  });

  it("dispose failure does not fail result (EC-8)", async () => {
    const stderr = vi.spyOn(process.stderr, "write");
    const create = async (options: AgentOptions): Promise<SDKAgent> => {
      const base = (await buildFakeFactory({ onSend: (p) => ({ kind: "ok", text: p }) })(
        options,
      )) as { dispose?: () => Promise<void> } & SDKAgent;
      base.dispose = async () => {
        throw new Error("dispose-fail");
      };
      return base;
    };
    const results = await batchImpl(["a"], baseOptions, { create });
    expect(results[0]?.ok).toBe(true);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("dispose-fail"));
    stderr.mockRestore();
  });

  it("filter applied post-collection (EC: filter)", async () => {
    const create = buildFakeFactory({
      onSend: (p) => (p === "skip" ? new Error("skip") : { kind: "ok", text: p }),
    });
    const results = await batchImpl(
      ["a", "skip", "c"],
      { ...baseOptions, filter: (r) => r.ok },
      { create },
    );
    expect(results.length).toBe(2);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("passes metadata through (EC-12)", async () => {
    const create = buildFakeFactory({ onSend: (p) => ({ kind: "ok", text: p }) });
    const items: BatchItem[] = [
      { prompt: "a", metadata: { id: 1 } },
      { prompt: "b", metadata: { id: 2 } },
    ];
    const results = await batchImpl(items, baseOptions, { create });
    expect(results[0]?.metadata).toEqual({ id: 1 });
    expect(results[1]?.metadata).toEqual({ id: 2 });
  });

  // EC-A: pool sharing
  it("EC-A: shares credential pool across concurrent batch agents", async () => {
    let seenPool: ReturnType<typeof currentCredentialPool>;
    let seenPool2: ReturnType<typeof currentCredentialPool>;
    let callCount = 0;
    const create = async (options: AgentOptions): Promise<SDKAgent> => {
      callCount += 1;
      if (callCount === 1) seenPool = currentCredentialPool("openrouter");
      if (callCount === 2) seenPool2 = currentCredentialPool("openrouter");
      const fake = await buildFakeFactory({ onSend: (p) => ({ kind: "ok", text: p }) })(options);
      return fake;
    };
    await batchImpl(
      ["a", "b"],
      {
        ...baseOptions,
        concurrency: 2,
        providers: { routes: [], apiKeys: { openrouter: ["k1", "k2"] } },
      },
      { create },
    );
    // Both agents see the SAME pool instance (reference identity)
    expect(seenPool).not.toBeUndefined();
    expect(seenPool2).not.toBeUndefined();
    expect(seenPool).toBe(seenPool2);
  });

  // EC-C: pre-aborted signal
  it("EC-C: pre-aborted signal returns all as abort errors", async () => {
    const create = buildFakeFactory({ onSend: (p) => ({ kind: "ok", text: p }) });
    const controller = new AbortController();
    controller.abort();
    const results = await batchImpl(
      ["a", "b", "c"],
      { ...baseOptions, signal: controller.signal },
      { create },
    );
    expect(results.length).toBe(3);
    expect(results.every((r) => !r.ok)).toBe(true);
    expect((results[0] as { error: TheokitAgentError }).error.code).toBe("aborted");
  });

  // EC-D: signal.reason propagation
  it("EC-D: abort preserves signal.reason", async () => {
    const create = buildFakeFactory({ onSend: (p) => ({ kind: "ok", text: p }) });
    const controller = new AbortController();
    controller.abort(new Error("user cancelled checkout"));
    const results = await batchImpl(
      ["a"],
      { ...baseOptions, signal: controller.signal },
      { create },
    );
    expect(results[0]?.ok).toBe(false);
    expect((results[0] as { error: TheokitAgentError }).error.message).toContain(
      "user cancelled checkout",
    );
  });

  // EC-B / B-110: `onResult` must be bounded by `concurrency`, not just the underlying agent work.
  //
  // B-023 shipped a test here under this exact name that asserted the OPPOSITE of what this
  // describes: at `concurrency: 1`, it required both `onResult` callbacks to be in flight AT THE
  // SAME TIME, and called that overlap the "contract". It passed because `runBatch` released the
  // semaphore permit in its `finally` and only THEN awaited `onResult` (batch.ts, pre-B-110) — so a
  // caller who asked for `concurrency: 1` got overlapping `onResult` invocations regardless. Measured
  // (B-110, 2026-08-19): a caller doing anything stateful in `onResult` — writing a file, appending
  // to a buffer, rate-limiting an API — got concurrency they explicitly refused. `types/batch.ts`
  // now says so explicitly: `concurrency` bounds the whole per-item lifecycle, `onResult` included.
  //
  // Fixed by moving the counters update + `await safeCallResult` inside the `try` that the semaphore
  // release's `finally` wraps, so the permit is held until the callback finishes.
  //
  // `concurrency: 1` is load-bearing, not incidental: at `concurrency: 2` the two callbacks may
  // overlap simply because the two prompts ran side by side, which proves nothing about whether
  // `onResult` itself is bounded. At 1 the prompts cannot run side by side, so ANY overlap can only
  // come from an early release — this is the one configuration that can tell a fixed implementation
  // from a broken one.
  it("test_on_result_is_bounded_by_the_concurrency_limit", async () => {
    const create = buildFakeFactory({ onSend: (p) => ({ kind: "ok", text: p }) });
    let releaseA!: () => void;
    const aGate = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    let aEntered = false;
    let bEntered = false;

    const batch = batchImpl(
      ["a", "b"],
      {
        ...baseOptions,
        concurrency: 1,
        onResult: async (r) => {
          if (r.prompt === "a") {
            aEntered = true;
            await aGate;
          } else {
            bEntered = true;
          }
        },
      },
      { create },
    );

    // No sleeps: `setImmediate` drains every microtask reachable through synchronous scheduling
    // (the fake agent's create → send → wait → dispose chain is all promises, no timers/IO), so this
    // single tick is enough for "a" to reach its blocked `onResult` — and, under the pre-fix code,
    // would ALSO have been enough for "b" to fully enter and exit its own (non-blocking) callback,
    // since its permit was released before "a"'s callback even started.
    await new Promise((r) => setImmediate(r));

    expect(aEntered, "the first prompt's onResult must have started").toBe(true);
    expect(
      bEntered,
      "the second onResult must NOT run while the first is still inside its callback — " +
        "concurrency:1 must bound onResult, not just the underlying agent work",
    ).toBe(false);

    releaseA();
    await batch;

    expect(bEntered, "and must run once the first callback finishes").toBe(true);
  });

  it("EC-B: the batch does not resolve until every onResult callback has finished", async () => {
    const create = buildFakeFactory({ onSend: (p) => ({ kind: "ok", text: p }) });
    let releaseCallbacks!: () => void;
    const callbacksMayFinish = new Promise<void>((resolve) => {
      releaseCallbacks = resolve;
    });
    let resolved = false;

    const batch = batchImpl(
      ["a", "b"],
      { ...baseOptions, concurrency: 2, onResult: () => callbacksMayFinish },
      { create },
    ).then((results) => {
      resolved = true;
      return results;
    });

    // The whole fixture path is promise-only (no timers), so one macrotask turn drains every
    // microtask the batch could still be waiting on. If the callbacks were not awaited, the batch
    // would already have settled here.
    await new Promise((r) => setImmediate(r));
    expect(resolved, "the batch must still be pending while a callback is unfinished").toBe(false);

    releaseCallbacks();
    const results = await batch;

    expect(resolved, "and must resolve once the callbacks do").toBe(true);
    expect(results.length, "with every prompt accounted for").toBe(2);
  });
});
