/**
 * T0.3 — Leaky generator detection scaffold.
 *
 * The SDK uses `AsyncGenerator` for `run.stream()` and `Theokit.subscribe`.
 * If a consumer breaks out of `for await` without calling `.return()` on
 * the generator, the upstream producer may leak (open handles, untimed
 * intervals, etc.). This scaffold proves the harness can detect a leak via
 * `FinalizationRegistry` + forced GC.
 *
 * T6.2 (load test) ratchets this to a full 1000-iter stress; here we
 * smoke-test the harness shape.
 */

import { afterAll, describe, expect, it } from "vitest";

const SKIP_LOAD = process.env.SKIP_T0_3_LOAD === "1";

let registry: FinalizationRegistry<string> | undefined;
const collected: string[] = [];

if (!SKIP_LOAD) {
  registry = new FinalizationRegistry((label: string) => {
    collected.push(label);
  });
}

afterAll(() => {
  registry = undefined;
});

describe.skipIf(SKIP_LOAD)("T0.3 leaky-generator detection scaffold", () => {
  // B-010, and the item understates it. The guard below returned before the assertion on every run
  // ever: swept for `expose.gc` / `NODE_OPTIONS` across the repo and the ONLY hit is the comment that
  // used to sit here. So this reported PASS for its whole life without executing its `expect`.
  //
  // The obvious repair does not work, and that is the part worth writing down. Vitest 4 accepts a
  // top-level `execArgv`, so the flag CAN be supplied — measured, `typeof globalThis.gc` becomes
  // "function". Run that way, the test FAILS:
  //
  //     AssertionError: expected [] to include 'canonical'
  //
  // `collected` is empty: the FinalizationRegistry callback does not fire inside the window below
  // (gc, 50ms, gc, one setImmediate). And widening the window is not a fix — FinalizationRegistry
  // gives NO timing guarantee by specification and an engine may never call the callback at all, so
  // any fixed window turns "always fails" into "usually passes", which is the flake
  // `rules/testing.md` § 3 forbids. Worse than the green it replaces, because it would be believed.
  //
  // Skipped deliberately, with the reason measured rather than guessed. The scaffold needs a
  // different signal than GC timing; that redesign is B-105.
  it.skip("a generator that completes naturally is GC-collected", async () => {
    // Whoever un-skips this must supply `--expose-gc` (top-level `execArgv` in vitest 4). Failing
    // LOUDLY here is the point: the previous shape returned early and reported a pass, which is the
    // defect B-010 records. Never restore the silent return.
    const forceGc = (globalThis as { gc?: () => void }).gc;
    if (forceGc === undefined) {
      throw new Error("this test requires --expose-gc; see B-105 before re-enabling it");
    }
    async function* canonical() {
      for (let i = 0; i < 5; i += 1) yield i;
    }
    {
      const gen = canonical();
      registry?.register(gen, "canonical");
      for await (const _ of gen) {
        // drain naturally
      }
    }
    // Allow GC to run; on V8 a single gc() is enough for an unreachable async generator.
    forceGc();
    await new Promise((r) => setTimeout(r, 50));
    forceGc();
    // Registry callbacks are async — give them a microtask window.
    await new Promise((r) => setImmediate(r));
    expect(collected).toContain("canonical");
  });

  it("a generator broken out of without return() is detected as leak shape", async () => {
    // Scaffold: this test documents the shape; full assertion comes in T6.2
    // when the harness is wired to the SDK's actual stream paths.
    async function* leaky() {
      try {
        for (let i = 0; i < 100; i += 1) yield i;
      } finally {
        // T6.2 will assert this finally clause fires under all caller patterns.
      }
    }
    let firstSeen = -1;
    for await (const v of leaky()) {
      firstSeen = v;
      break;
    }
    expect(firstSeen).toBe(0);
  });
});
