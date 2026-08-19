import { describe, expect, it, vi } from "vitest";

import {
  runInputProcessors,
  runOutputProcessors,
} from "../src/internal/runtime/processors/run-processors.js";
import type { Processor } from "../src/types/processors.js";

/**
 * SE24 — the guardrail processor runner. Ordered pipeline over a string payload:
 * rewrite (return string), abort() → tripwire (short-circuits), warn() → fire
 * onViolation + continue. A non-abort throw propagates (fail-fast).
 */

describe("SE24 — processor runner", () => {
  it("composes rewrites in order (input)", async () => {
    const procs: Processor[] = [
      { id: "upper", processInput: (ctx) => ctx.message.toUpperCase() },
      { id: "bang", processInput: (ctx) => `${ctx.message}!` },
    ];
    const res = await runInputProcessors(procs, "hi", "a1");
    expect(res).toEqual({ kind: "ok", value: "HI!" });
  });

  it("abort() yields a tripwire and short-circuits the rest", async () => {
    const later = vi.fn((ctx: { message: string }) => ctx.message);
    const procs: Processor[] = [
      { id: "guard", processInput: (ctx) => ctx.abort("blocked: pii") },
      { id: "never", processInput: later },
    ];
    const res = await runInputProcessors(procs, "my ssn is 1", "a1");
    expect(res).toEqual({
      kind: "tripwire",
      tripwire: { reason: "blocked: pii", processorId: "guard" },
    });
    expect(later).not.toHaveBeenCalled(); // short-circuit
  });

  it("abort() fires onViolation exactly once with the right payload", async () => {
    const onViolation = vi.fn();
    const procs: Processor[] = [
      { id: "mod", processInput: (ctx) => ctx.abort("hate"), onViolation },
    ];
    await runInputProcessors(procs, "x", "a1");
    expect(onViolation).toHaveBeenCalledTimes(1);
    expect(onViolation).toHaveBeenCalledWith({ processorId: "mod", message: "hate" });
  });

  it("warn() fires onViolation and continues (non-blocking)", async () => {
    const onViolation = vi.fn();
    const procs: Processor[] = [
      {
        id: "detect",
        processInput: (ctx) => {
          ctx.warn("suspicious", { score: 0.4 });
          return ctx.message;
        },
        onViolation,
      },
      { id: "next", processInput: (ctx) => `${ctx.message}-ok` },
    ];
    const res = await runInputProcessors(procs, "hello", "a1");
    expect(res).toEqual({ kind: "ok", value: "hello-ok" });
    expect(onViolation).toHaveBeenCalledWith({
      processorId: "detect",
      message: "suspicious",
      detail: { score: 0.4 },
    });
  });

  it("redacts on the output phase", async () => {
    const procs: Processor[] = [
      { id: "redact", processOutput: (ctx) => ctx.text.replace(/\d{3}-\d{2}-\d{4}/, "[REDACTED]") },
    ];
    const res = await runOutputProcessors(procs, "ssn 123-45-6789 done", "a1");
    expect(res).toEqual({ kind: "ok", value: "ssn [REDACTED] done" });
  });

  it("skips a processor that lacks the phase method", async () => {
    const procs: Processor[] = [{ id: "out-only", processOutput: (ctx) => ctx.text }];
    const res = await runInputProcessors(procs, "unchanged", "a1");
    expect(res).toEqual({ kind: "ok", value: "unchanged" });
  });

  it("propagates a non-abort throw (processor bug, fail-fast)", async () => {
    const procs: Processor[] = [
      {
        id: "buggy",
        processInput: () => {
          throw new Error("boom");
        },
      },
    ];
    await expect(runInputProcessors(procs, "x", "a1")).rejects.toThrow("boom");
  });

  it("a processor that returns void preserves the previous value", async () => {
    const procs: Processor[] = [
      {
        id: "sniff",
        processInput: () => {
          /* observe only, return nothing */
        },
      },
    ];
    const res = await runInputProcessors(procs, "kept", "a1");
    expect(res).toEqual({ kind: "ok", value: "kept" });
  });

  it("awaits an async processor", async () => {
    const procs: Processor[] = [
      {
        id: "async-upper",
        processInput: async (ctx) => {
          await Promise.resolve();
          return ctx.message.toUpperCase();
        },
      },
    ];
    const res = await runInputProcessors(procs, "hi", "a1");
    expect(res).toEqual({ kind: "ok", value: "HI" });
  });

  // B-043. These two were one `it` whose name joined two claims with a semicolon, over two
  // independent fixtures. The first failure masked the second: if warn() stopped firing
  // onViolation the throw-propagation half never ran, and the report named one failure for two
  // broken contracts. Split, one fixture each.
  it("output phase: warn() fires onViolation and lets the pipeline continue", async () => {
    const onViolation = vi.fn();
    const warnProcs: Processor[] = [
      {
        id: "owarn",
        processOutput: (ctx) => {
          ctx.warn("odd output", { n: 1 });
          return ctx.text;
        },
        onViolation,
      },
      // The word in the name is *continue*, so a downstream processor has to exist for the
      // pipeline to continue INTO — with a single processor, `kind: "ok"` is also what a
      // warn() that short-circuited like abort() would produce. Mirrors the input-phase test.
      { id: "after", processOutput: (ctx) => `${ctx.text}-after` },
    ];

    const ok = await runOutputProcessors(warnProcs, "text", "a1");

    expect(ok, "warn() must not short-circuit — the processor after it still runs").toEqual({
      kind: "ok",
      value: "text-after",
    });
    expect(onViolation).toHaveBeenCalledWith({
      processorId: "owarn",
      message: "odd output",
      detail: { n: 1 },
    });
  });

  it("output phase: a non-abort throw from a processor propagates", async () => {
    const buggy: Processor[] = [
      {
        id: "obug",
        processOutput: () => {
          throw new Error("output boom");
        },
      },
    ];

    await expect(runOutputProcessors(buggy, "text", "a1")).rejects.toThrow("output boom");
  });

  it("an onViolation callback that throws never breaks the pipeline", async () => {
    const procs: Processor[] = [
      {
        id: "noisy",
        processInput: (ctx) => ctx.abort("stop"),
        onViolation: () => {
          throw new Error("callback bug");
        },
      },
    ];
    const res = await runInputProcessors(procs, "x", "a1");
    expect(res).toEqual({ kind: "tripwire", tripwire: { reason: "stop", processorId: "noisy" } });
  });
});
