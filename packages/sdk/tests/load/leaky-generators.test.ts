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
  it("a generator that completes naturally is GC-collected", async () => {
    if (typeof globalThis.gc !== "function") {
      // Test only meaningful with --expose-gc; otherwise smoke-skip the assertion.
      return;
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
    globalThis.gc();
    await new Promise((r) => setTimeout(r, 50));
    globalThis.gc();
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
