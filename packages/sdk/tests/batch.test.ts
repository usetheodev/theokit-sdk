/**
 * Tests for batchImpl (T2.1, ADRs D134-D140).
 *
 * Uses fake agent factory via injected deps.create — no real LLM.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { batchImpl } from "../src/batch.js";
import { ConfigurationError, type TheokitAgentError } from "../src/errors.js";
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

  // EC-B: a slow onResult must not serialise the batch, and must still be waited for.
  //
  // B-023. One test asserted both halves through a single wall-clock window: two 50ms callbacks had
  // to land in [45ms, 150ms) — the floor standing for "they overlapped" and the ceiling for "the
  // batch waited". Both bounds measure the host. The floor was already acknowledged as fragile in
  // the code ("tolerates setTimeout coarse resolution"), and the ceiling is 3x a 50ms budget on a
  // suite whose config raises testTimeout to 20s because of documented libuv saturation across 18
  // parallel package runs — the same contention that pushes elapsed past 150ms.
  //
  // Split into the two behaviours the window was conflating, each asserted on a signal instead.
  //
  // `concurrency: 1` is load-bearing, not incidental. `runBatch` releases the semaphore in its
  // `finally` and only THEN awaits `onResult` (batch.ts:173-178), so result callbacks are
  // deliberately NOT gated by the concurrency limit — that is the contract under test here. At
  // `concurrency: 2` the two callbacks may overlap simply because the two prompts ran side by side,
  // so the overlap proves nothing about where `safeCallResult` sits relative to `release()`.
  // At 1 the prompts cannot run side by side, so ANY overlap can only come from the early release.
  //
  // Measured: with `concurrency: 2` this test SURVIVES a mutant that moves `safeCallResult` inside
  // the semaphore; with 1 that mutant is killed. A test that documents a contract it cannot see
  // violated is a comment, not a test.
  it("EC-B: onResult callbacks for concurrent prompts overlap", async () => {
    const create = buildFakeFactory({ onSend: (p) => ({ kind: "ok", text: p }) });
    const timeline: string[] = [];
    // Holds each callback until BOTH are inside it. Serialised callbacks can never satisfy that, at
    // any host speed; the deadline is a failure bound, not a synchroniser.
    const bothInFlight = barrier(2, "both onResult callbacks to be in flight at the same time");

    await batchImpl(
      ["a", "b"],
      {
        ...baseOptions,
        concurrency: 1,
        onResult: async (r) => {
          timeline.push(`enter:${r.prompt}`);
          await bothInFlight.arrive();
          timeline.push(`exit:${r.prompt}`);
        },
      },
      { create },
    );

    expect(
      bothInFlight.timedOutWith(),
      "the barrier must not have timed out (its message names what never happened)",
    ).toBeUndefined();
    expect(timeline.slice(0, 2).sort(), "both callbacks must start before either finishes").toEqual(
      ["enter:a", "enter:b"],
    );
    expect(timeline.slice(2).sort(), "and both must then finish").toEqual(["exit:a", "exit:b"]);
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

/**
 * Resolves once `n` callers have arrived, so a callback can be held until its siblings are also
 * in flight. Rejects — naming what never happened — if that never becomes true.
 *
 * B-023. Overlap is only *observable* if the observer can hold both participants at once; a sleep
 * makes overlap probable, a barrier makes it required. The deadline exists so a serialised
 * implementation fails with a sentence instead of hanging until the suite timeout.
 */
function barrier(
  n: number,
  description: string,
  timeoutMs = 5_000,
): { arrive: () => Promise<void>; timedOutWith: () => Error | undefined } {
  let arrived = 0;
  let timedOutWith: Error | undefined;
  let open!: () => void;
  let fail!: (err: Error) => void;
  const gate = new Promise<void>((resolve, reject) => {
    open = resolve;
    fail = reject;
  });
  const timer = setTimeout(() => {
    timedOutWith = new Error(`timed out after ${timeoutMs}ms waiting for: ${description}`);
    fail(timedOutWith);
  }, timeoutMs);
  timer.unref();
  return {
    arrive: async (): Promise<void> => {
      arrived += 1;
      if (arrived === n) {
        clearTimeout(timer);
        open();
      }
      return gate;
    },
    // The timeout is ALSO recorded, not just thrown, because this barrier is awaited inside an
    // `onResult` callback and `safeCallResult` (batch.ts:300-311) deliberately swallows whatever a
    // user callback throws. Without this the sentence naming what never happened would reach only
    // stderr, and the visible failure would be a bare empty-array diff. The sibling copy in
    // parallel-dispatch.test.ts needs no such accessor — nothing swallows it there.
    timedOutWith: (): Error | undefined => timedOutWith,
  };
}
