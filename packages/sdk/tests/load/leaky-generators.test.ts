/**
 * B-105 / B-037 — generator cleanup, asserted deterministically against real SDK code.
 *
 * This file used to be a T0.3 scaffold that imported no SDK source and proved nothing. Two separate
 * defects, both measured before this rewrite:
 *
 * **1. The mechanism could not work.** The old test asked `FinalizationRegistry` whether a generator
 * had been collected, behind a guard on `globalThis.gc` that was never satisfied — no `--expose-gc`
 * exists anywhere in the repo, so it reported PASS without executing its `expect` for its whole life
 * (B-010). Supplying the flag is possible (vitest 4 accepts a top-level `execArgv`) and makes it
 * FAIL: `expected [] to include 'canonical'`, because the registry callback does not fire inside any
 * window the test can allow. Widening the window is not a fix — `FinalizationRegistry` carries NO
 * timing guarantee by specification and an engine may never invoke the callback at all, so a fixed
 * window converts "always fails" into "usually passes", which is the flake `rules/testing.md` § 3
 * forbids and is worse than the false green it replaces, because it would be believed.
 *
 * **2. The premise was wrong.** The old docblock said "if a consumer breaks out of `for await`
 * without calling `.return()` on the generator, the upstream producer may leak". Measured:
 *
 * ```
 * after break     -> cleanup: ["break"]
 * after abandon   -> cleanup: []
 * after .return() -> cleanup: ["explicit"]
 * after throw     -> cleanup: ["threw"]
 * ```
 *
 * `break` does not leak. The `for await...of` protocol calls `.return()` on the iterator for you, on
 * both `break` and `throw`. The shape that genuinely leaks is a consumer that takes the iterator by
 * hand and abandons it — and that shape is observable with no GC involved at all, because the
 * generator's `finally` clause either ran or it did not.
 *
 * So the scaffold is replaced rather than repaired, and it is pointed at the SDK surface its own
 * docblock named. `Task.subscribe` returns an `AsyncIterable` whose iterator implements `return()`
 * for leak-free cleanup (EC-10, `internal/task/subscribe.ts`), and the registry can be asked how many
 * subscribers a task currently has. That count is the deterministic signal: no timers, no GC, no
 * window.
 *
 * Mutation-verified rather than argued — see the demonstration recorded on B-105 in BACKLOG.md:
 * deleting `TaskIterator.return()` turns the break case RED while leaving the abandon case green,
 * which is exactly the asymmetry that proves the oracle reads cleanup and not merely iteration.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  __getSubscribersCountForTests,
  __resetTaskRegistryForTests,
  submit,
  subscribe,
} from "../../src/internal/task/registry.js";
import type { TaskEvent } from "../../src/types/task.js";

const SKIP_LOAD = process.env.SKIP_T0_3_LOAD === "1";

interface Deferred {
  promise: Promise<void>;
  release: () => void;
}

function deferred(): Deferred {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe.skipIf(SKIP_LOAD)("generator cleanup on the SDK's task event stream", () => {
  let gate: Deferred;
  let taskId: string;

  beforeEach(async () => {
    __resetTaskRegistryForTests();
    gate = deferred();
    // The task must stay non-terminal for the whole test: a terminal event triggers cleanup on its
    // own, which would make every case below pass for the wrong reason.
    const handle = await submit({
      kind: "custom",
      work: async () => {
        await gate.promise;
        return "done";
      },
    });
    taskId = handle.id;
  });

  afterEach(() => {
    gate.release();
    __resetTaskRegistryForTests();
  });

  it("test_breaking_out_of_for_await_releases_the_subscriber", async () => {
    // The SDK's EC-10 guarantee. `break` is safe BECAUSE the iteration protocol calls `return()` —
    // not because nothing was registered. The mid-loop count is what tells those two apart.
    let countInsideLoop = -1;

    for await (const _event of subscribe(taskId) as AsyncIterable<TaskEvent>) {
      countInsideLoop = __getSubscribersCountForTests(taskId);
      break;
    }

    expect(countInsideLoop, "the subscriber must be registered while the loop is running").toBe(1);
    expect(
      __getSubscribersCountForTests(taskId),
      "breaking out of for-await must release the subscriber",
    ).toBe(0);
  });

  it("test_an_iterator_abandoned_without_return_leaks_the_subscriber", async () => {
    // The shape that actually leaks, and the one the old scaffold thought `break` was. Taking the
    // iterator by hand skips the protocol's implicit `return()`, so nothing releases it.
    const iterator = (subscribe(taskId) as AsyncIterable<TaskEvent>)[Symbol.asyncIterator]();
    await iterator.next();

    expect(
      __getSubscribersCountForTests(taskId),
      "an abandoned iterator leaves its subscriber registered — this is the leak",
    ).toBe(1);
  });

  it("test_calling_return_explicitly_releases_the_subscriber", async () => {
    // The manual consumer's escape hatch, and the mechanism `for await` invokes on its behalf.
    const iterator = (subscribe(taskId) as AsyncIterable<TaskEvent>)[Symbol.asyncIterator]();
    await iterator.next();
    expect(__getSubscribersCountForTests(taskId)).toBe(1);

    await iterator.return?.(undefined);

    expect(__getSubscribersCountForTests(taskId)).toBe(0);
  });

  it("test_throwing_out_of_for_await_releases_the_subscriber", async () => {
    // A consumer whose loop body throws is the ordinary failure path, and it must not leak either.
    // Same protocol call as `break`, different exit — worth its own case because a `return()` wired
    // only into the break path would pass the test above and fail here.
    await expect(
      (async () => {
        for await (const _event of subscribe(taskId) as AsyncIterable<TaskEvent>) {
          throw new Error("consumer failed mid-stream");
        }
      })(),
    ).rejects.toThrow("consumer failed mid-stream");

    expect(__getSubscribersCountForTests(taskId)).toBe(0);
  });
});

describe("the language guarantee the old scaffold got backwards", () => {
  // Pinned because the misreading is what produced a GC-based test for a problem that has an exact
  // answer. `for await...of` calls `.return()` on the iterator when the loop exits early, so the
  // generator's `finally` runs on break and on throw. Only a hand-driven iterator escapes it.
  async function* tracked(cleanup: string[], label: string): AsyncGenerator<number> {
    try {
      for (let i = 0; i < 100; i += 1) yield i;
    } finally {
      cleanup.push(label);
    }
  }

  it("test_break_and_throw_run_the_generators_finally_but_abandonment_does_not", async () => {
    const cleanup: string[] = [];

    for await (const _v of tracked(cleanup, "break")) break;

    await expect(
      (async () => {
        for await (const _v of tracked(cleanup, "threw")) throw new Error("x");
      })(),
    ).rejects.toThrow("x");

    const abandoned = tracked(cleanup, "abandoned")[Symbol.asyncIterator]();
    await abandoned.next();

    expect(cleanup).toEqual(["break", "threw"]);
    expect(cleanup, "abandonment is the only shape that skips the finally").not.toContain(
      "abandoned",
    );
  });
});
