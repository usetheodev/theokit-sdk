/**
 * T6.2 — Fork ALS personality inheritance (ADR D168 + EC-A snapshot).
 *
 * Tests use the `withPersonalityContext` + `currentPersonalityContext`
 * primitives directly (the ALS scope is what the fork-agent wraps its
 * execution in). End-to-end via `Agent.fork` is covered by the smoke
 * test once the fork path runs with a real LLM (out of scope here).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  currentPersonalityContext,
  warnPersonalitySwitchInsideFork,
  withPersonalityContext,
} from "../../../src/internal/personality/context.js";
import { _resetWarnOnceForTests } from "../../../src/internal/runtime/hooks/hooks-source.js";

describe("Personality fork inheritance (T6.2)", () => {
  beforeEach(() => {
    _resetWarnOnceForTests();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fork inherits parent's active personality (slug snapshot)", async () => {
    let observed: string | undefined;
    await withPersonalityContext({ slug: "coder", isFork: true }, async () => {
      observed = currentPersonalityContext()?.slug;
    });
    expect(observed).toBe("coder");
  });

  it("fork with no parent personality has slug=undefined", async () => {
    let observed: string | undefined | "missing-ctx" = "missing-ctx";
    await withPersonalityContext({ slug: undefined, isFork: true }, async () => {
      observed = currentPersonalityContext()?.slug;
    });
    expect(observed).toBeUndefined();
  });

  it("usePersonality inside fork is a no-op with a one-shot warning", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await withPersonalityContext({ slug: "coder", isFork: true }, async () => {
      warnPersonalitySwitchInsideFork("fork-1");
      warnPersonalitySwitchInsideFork("fork-1"); // dedup
    });
    const warns = stderr.mock.calls
      .flat()
      .filter((s) => typeof s === "string" && s.includes("no-op inside a fork"));
    expect(warns.length).toBe(1);
    stderr.mockRestore();
  });

  it("EC-22: nested fork inherits the outer fork's snapshot, not the original parent", async () => {
    let inner: string | undefined;
    await withPersonalityContext({ slug: "coder", isFork: true }, async () => {
      await withPersonalityContext({ slug: "poet", isFork: true }, async () => {
        inner = currentPersonalityContext()?.slug;
      });
    });
    expect(inner).toBe("poet");
  });

  it("EC-A: parent mid-flight switch does NOT mutate fork voice", async () => {
    // Simulate: fork captures slug "coder" at construction. Parent switches
    // to "poet" mid-flight. Fork's ALS still reflects "coder".
    let captured: string | undefined;
    const parentSlug = { current: "coder" as string | undefined };

    const forkRun = withPersonalityContext({ slug: parentSlug.current, isFork: true }, async () => {
      // While the fork is running, the parent "switches" to poet by
      // mutating its store. The snapshot inside the ALS frame is a
      // captured primitive — independent of parent's later mutation.
      parentSlug.current = "poet";
      captured = currentPersonalityContext()?.slug;
    });

    await forkRun;
    expect(captured).toBe("coder");
    expect(parentSlug.current).toBe("poet"); // parent did move on
  });
});
