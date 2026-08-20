/**
 * T0.3 — Chaos: OOM recovery scaffold.
 *
 * Per SEPA initial brief § E, OOM scenarios spawn a Node child with
 * `--max-old-space-size=128` so the heap exhausts predictably. The parent
 * must observe a clean exit code (typically 134 / SIGABRT or 1 with
 * `JavaScript heap out of memory` on stderr) AND not crash itself.
 *
 * T6.5 wires this against the SDK's memory subsystem (specifically the
 * Active Memory + dreaming sweep paths that allocate per-query) and
 * asserts circuit-breaker triggers + telemetry records the OOM event.
 */

import { describe, expect, it } from "vitest";

import { spawnNodeChild } from "./_harness/process-control.js";

const SKIP_CHAOS = process.env.SKIP_T0_3_CHAOS === "1";

describe.skipIf(SKIP_CHAOS)("T0.3 oom-recovery chaos scaffold", () => {
  it("child with --max-old-space-size=64 exits under heap blow without crashing parent", async () => {
    // Use a tighter heap cap (64MB) + larger allocation to guarantee OOM
    // across V8 versions. The harness's invariant is that the PARENT
    // observes a clean exit (zero or non-zero) AND keeps running — the
    // specific exit code depends on V8 GC behavior and OS resource limits.
    const child = spawnNodeChild({
      nodeArgs: ["--max-old-space-size=64", "-e"],
      scriptPath:
        "try{const bag=[];for(let i=0;i<2000000;i+=1){bag.push(' '.repeat(1024));}process.stdout.write('survived\\n');}catch(e){process.stderr.write('oom-error: '+e.message+'\\n');process.exit(7);}",
    });
    const result = await child.exitPromise;

    // B-037. The two assertions here used to be
    //   expect(result.code !== undefined || result.signal !== null).toBe(true)
    //   expect(typeof process.uptime).toBe("function")
    // and neither could fail: `code` is `number | null`, so the left disjunct is always true, and
    // `process.uptime` is a function in every Node that can run this file. A test whose whole
    // assertion budget is constant-true reports the harness as working no matter what it does.
    //
    // Measured on this exact script (node --max-old-space-size=64, 2M x 1KB strings):
    //   FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
    //   EXIT=134
    // V8's OOM is a fatal process abort, NOT a catchable JS exception — so the script's own
    // `catch { process.exit(7) }` never runs. Worth stating rather than allowing for: writing
    // `|| result.code === 7` would be tolerance for a path this program cannot take.
    //
    // Verified to fail on the condition it exists to catch: raising the cap to 4096 and shrinking
    // the loop to 1000 iterations (a child that survives) turns this RED with
    // "the OOM child must abort, not exit cleanly: expected +0 not to be +0".
    expect(result.code, "the OOM child must abort, not exit cleanly").not.toBe(0);
    expect(
      child.stdoutLines,
      "the allocation loop must not complete — 'survived' means the heap cap did not bite",
    ).not.toContain("survived");
  }, 30_000);

  it.todo(
    "an OOM in the memory sweep trips the circuit breaker and records telemetry — owner B-037, sunset 2026-11-19 (T6.5)",
  );
});
