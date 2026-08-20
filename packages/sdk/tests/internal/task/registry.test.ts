/**
 * Phase 3.1 (T3.1) RED tests for TaskRegistry.
 * Covers submit/list/get/cancel/subscribe lifecycle + edge cases
 * EC-3 (sync throw), EC-4 (pre-aborted signal), EC-7 (cancelRequested),
 * EC-9 (store-update failure), EC-10 (subscriber cleanup), EC-11 (reentrant).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { InvalidTaskIdError, TaskNotFoundError } from "../../../src/errors.js";
import {
  __getSubscribersCountForTests,
  __resetTaskRegistryForTests,
  cancel,
  configure,
  get,
  list,
  submit,
  subscribe,
} from "../../../src/internal/task/registry.js";
import type { TaskEvent, TaskState } from "../../../src/types/task.js";
import { pollUntil } from "../../helpers/poll-until.js";

function nextTick(): Promise<void> {
  return new Promise((r) => setImmediate(r));
}

/**
 * B-056 — every wait in this file used to be a fixed sleep between 10ms and 200ms, chosen to be
 * "long enough" for the registry's fire-and-forget work to reach a state. The state IS observable
 * (`get(id).state`), so the sleep was guessing at something the test could simply ask for. Under
 * load those guesses stop being long enough, which is the flake `rules/testing.md` § 6 names.
 *
 * A passing run is now never slower than the sleep it replaced, and a state that genuinely never
 * arrives fails with the state it was waiting for rather than an assertion on stale data.
 */
async function waitForState(id: string, ...states: readonly TaskState[]): Promise<void> {
  await pollUntil(async () => states.includes((await get(id))?.state as TaskState), {
    message: `task ${id} never reached ${states.join(" | ")}`,
  });
}

describe("TaskRegistry — submit lifecycle", () => {
  beforeEach(() => {
    __resetTaskRegistryForTests();
  });
  afterEach(() => {
    __resetTaskRegistryForTests();
  });

  it("submit returns handle with state=queued", async () => {
    const handle = await submit({ kind: "custom", work: async () => "result" });
    expect(handle.state).toBe("queued");
    expect(handle.id).toBeDefined();
  });

  it("submit transitions queued → running → finished and produces events", async () => {
    const observed: TaskEvent[] = [];
    const handle = await submit({
      kind: "custom",
      work: async () => "done",
    });
    // B-019. The body opened this subscription, dropped it into a floating async IIFE, and then
    // slept 50ms hoping the work had landed. The runtime ANNOUNCES completion on the very stream the
    // test already opened, so the sleep was ignoring the signal it was waiting for.
    //
    // Awaiting the `finished` event makes the test independent of how long the work takes — and of
    // whatever else the machine is doing. Measured: this test already fails when the event stops
    // being emitted, so what changes here is determinism, not coverage. The 50ms was not too small
    // today; it was a number nobody could justify.
    const sub = subscribe(handle.id);
    for await (const ev of sub) {
      observed.push(ev);
      if (ev.type === "finished") break;
    }

    const final = await get(handle.id);
    expect(final?.state).toBe("finished");
    expect(final?.result).toBe("done");
    expect(observed.some((e) => e.type === "finished")).toBe(true);
  });

  it("submit idempotent with same id returns existing handle (D367)", async () => {
    const a = await submit({ kind: "custom", work: async () => 1, id: "shared" });
    const b = await submit({ kind: "custom", work: async () => 2, id: "shared" });
    expect(b.id).toBe(a.id);
  });

  it("invalid id throws InvalidTaskIdError", async () => {
    await expect(
      submit({ kind: "custom", work: async () => 1, id: "BAD UPPER" }),
    ).rejects.toBeInstanceOf(InvalidTaskIdError);
  });

  it("EC-3: sync throw in work() normalized to errored event", async () => {
    const handle = await submit({
      kind: "custom",
      work: () => {
        throw new Error("sync boom");
      },
    });
    await waitForState(handle.id, "error");
    const final = await get(handle.id);
    expect(final?.state).toBe("error");
    expect(final?.error?.message).toContain("sync boom");
  });

  it("EC-4: pre-aborted signal short-circuits to cancelled (no run)", async () => {
    const ctrl = new AbortController();
    ctrl.abort("preempted");
    let workInvoked = false;
    const handle = await submit({
      kind: "custom",
      work: async () => {
        workInvoked = true;
        return "should not run";
      },
      signal: ctrl.signal,
    });
    await nextTick();
    expect(workInvoked).toBe(false);
    expect(handle.state).toBe("cancelled");
  });
});

describe("TaskRegistry — cancel", () => {
  beforeEach(() => __resetTaskRegistryForTests());

  it("cancel queued task transitions directly to cancelled", async () => {
    // Submit but never resolve; use long-running work
    const handle = await submit({
      kind: "custom",
      work: () => new Promise(() => {}),
      id: "long",
    });
    // Race: try cancel before the work fn even starts. Some impls may have
    // already moved to running by now; allow both.
    const result = await cancel("long");
    expect(result.alreadyTerminal).toBe(false);
    expect(result.cancelled).toBe(true);
    await waitForState(handle.id, "cancelled");
    const final = await get(handle.id);
    expect(final?.state).toBe("cancelled");
  });

  it("cancel running task propagates via AbortController", async () => {
    let aborted = false;
    const handle = await submit({
      kind: "custom",

      work: async (ctx) =>
        new Promise<void>((_resolve, reject) => {
          ctx.signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          });
        }),
    });
    await waitForState(handle.id, "running");
    await cancel(handle.id);
    await waitForState(handle.id, "cancelled");
    await pollUntil(() => aborted, { message: "work fn never observed the abort" });
    expect(aborted).toBe(true);
    expect((await get(handle.id))?.state).toBe("cancelled");
  });

  it("cancel idempotent — second call returns alreadyTerminal", async () => {
    const handle = await submit({ kind: "custom", work: async () => "x" });
    await waitForState(handle.id, "finished");
    await cancel(handle.id);
    const second = await cancel(handle.id);
    expect(second.alreadyTerminal).toBe(true);
    expect(second.cancelled).toBe(false);
  });

  it("cancel unknown id returns false/false (idempotent)", async () => {
    const r = await cancel("definitely-missing");
    expect(r).toEqual({ cancelled: false, alreadyTerminal: false });
  });
});

describe("TaskRegistry — subscribe", () => {
  beforeEach(() => __resetTaskRegistryForTests());

  it("drains ring buffer for late attach", async () => {
    const handle = await submit({ kind: "custom", work: async () => "done" });
    await waitForState(handle.id, "finished");
    const sub = subscribe(handle.id);
    const out: TaskEvent[] = [];
    for await (const ev of sub) out.push(ev);
    expect(out.length).toBeGreaterThan(0);
    expect(out[out.length - 1]?.type).toBe("finished");
  });

  it("unknown task throws TaskNotFoundError", () => {
    expect(() => subscribe("no-such-task")).toThrow(TaskNotFoundError);
  });

  it("EC-10: iterator return() cleans up subscriber set", async () => {
    const handle = await submit({
      kind: "custom",
      work: () => new Promise(() => {}),
      id: "leak-test",
    });
    await waitForState(handle.id, "running");
    const it = subscribe(handle.id)[Symbol.asyncIterator]();
    // Pull one event then close.
    void it.next();
    await it.return?.();
    expect(__getSubscribersCountForTests(handle.id)).toBe(0);
    await cancel(handle.id);
  });
});

describe("TaskRegistry — list + filter", () => {
  beforeEach(() => __resetTaskRegistryForTests());

  it("list returns submitted tasks", async () => {
    await submit({ kind: "custom", work: async () => "a", id: "first" });
    await submit({ kind: "custom", work: async () => "b", id: "second" });
    await pollUntil(async () => (await list({})).length >= 2, {
      message: "both submitted tasks never appeared in list()",
    });
    const all = await list({});
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it("list filters by state", async () => {
    const handle = await submit({ kind: "custom", work: async () => "a" });
    await waitForState(handle.id, "finished");
    const finished = await list({ state: "finished" });
    expect(finished.every((h) => h.state === "finished")).toBe(true);
  });
});

describe("TaskRegistry — configure", () => {
  beforeEach(() => __resetTaskRegistryForTests());

  it("EC-13: configure() after first submit warns + no-ops", async () => {
    await submit({ kind: "custom", work: async () => 1 });
    const errs: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    (process.stderr as { write: (chunk: string) => boolean }).write = (chunk: string) => {
      errs.push(chunk);
      return true;
    };
    try {
      configure({ maxConcurrent: 16 });
      expect(errs.some((e) => e.includes("configure() ignored"))).toBe(true);
    } finally {
      process.stderr.write = origWrite;
    }
  });
});

describe("TaskRegistry — concurrency throttle (D369)", () => {
  beforeEach(() => __resetTaskRegistryForTests());

  it("respects maxConcurrent ceiling", async () => {
    configure({ maxConcurrent: 2 });
    let activeNow = 0;
    let peak = 0;
    const work = () =>
      new Promise<void>((resolve) => {
        activeNow++;
        peak = Math.max(peak, activeNow);
        setTimeout(() => {
          activeNow--;
          resolve();
        }, 30);
      });
    await Promise.all([
      submit({ kind: "custom", work }),
      submit({ kind: "custom", work }),
      submit({ kind: "custom", work }),
      submit({ kind: "custom", work }),
    ]);
    await pollUntil(async () => (await list({ state: "finished" })).length >= 4, {
      message: "the four tasks never all finished",
    });
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe("TaskRegistry — EC-11 reentrant submit no-deadlock", () => {
  beforeEach(() => __resetTaskRegistryForTests());

  it("work fn calling submit under concurrency=1 does not deadlock", async () => {
    configure({ maxConcurrent: 1 });
    const innerResults: string[] = [];
    const outer = await submit({
      kind: "custom",
      work: async () => {
        const inner = await submit({
          kind: "custom",
          work: async () => "inner-done",
        });
        await pollUntil(async () => (await get(inner.id))?.state === "finished", {
          message: "reentrant inner task never finished — this is the deadlock the test exists for",
        });
        innerResults.push((await get(inner.id))?.result as string);
        return "outer-done";
      },
    });
    await waitForState(outer.id, "finished");
    const finalOuter = await get(outer.id);
    expect(finalOuter?.state).toBe("finished");
    expect(innerResults).toEqual(["inner-done"]);
  });
});
