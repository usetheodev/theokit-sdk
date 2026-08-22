/**
 * T0.3 — Chaos: SIGKILL a child mid-stream.
 *
 * The parent must NOT crash when a spawned child producing a stream is
 * killed mid-emit. This scaffold spawns `node -e` to produce a fixed
 * sequence of stdout lines, kills it after the first line, and asserts the
 * parent stayed alive AND captured at least one stdout line.
 *
 * T6.3 ratchets to the SDK's actual streaming surface (real-LLM streaming
 * + child-process tool, SIGKILL injection mid-tool-loop, recovery).
 */

import { describe, expect, it } from "vitest";

import { killMidStream, spawnNodeChild, waitForStdout } from "./_harness/process-control.js";

const SKIP_CHAOS = process.env.SKIP_T0_3_CHAOS === "1";

describe.skipIf(SKIP_CHAOS)("T0.3 kill-mid-stream chaos scaffold", () => {
  it("parent process survives SIGKILL of a streaming child", async () => {
    const child = spawnNodeChild({
      nodeArgs: ["-e"],
      scriptPath:
        "let i=0;const t=setInterval(()=>{i+=1;process.stdout.write('tick '+i+'\\n');if(i>500)clearInterval(t);},10);",
    });
    try {
      await waitForStdout(child, (l) => l.startsWith("tick "), 5_000);
      const result = await killMidStream(child, 3_000);
      expect(result.signal === "SIGKILL" || result.code !== 0).toBe(true);
      // B-037: `expect(typeof process.uptime).toBe("function")` stood here as the "parent survived"
      // assertion. It cannot fail — if the parent had died there would be no assertion to run at
      // all. Parent survival is proven by this test reaching its end and by the ones after it, not
      // by asking Node whether a built-in exists.
    } finally {
      if (!child.child.killed) child.child.kill("SIGKILL");
    }
  }, 30_000);

  it.todo(
    "SIGKILL mid-tool-loop leaves the agent run recoverable — owner B-037, sunset 2026-11-19 (T6.3)",
  );
});
