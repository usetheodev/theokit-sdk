/**
 * The connect handshake is not bounded by the per-request timeout — proven through the CLIENT, so
 * the rule and its wiring are both covered.
 *
 * `requestTimeoutMs` sizes a steady-state RPC. The handshake is not one: it pays for a process spawn
 * plus the server's own startup before it can answer. Binding both to the same number means a caller
 * who sets a tight request budget — an ordinary thing to do for a latency SLO — silently makes their
 * client unable to CONNECT, and unable to RECONNECT after a drop: `reconnect()` burns all its
 * attempts, each spawning a child that cannot finish in time, and surfaces `mcp_disconnected`. That
 * is exactly the wedge the bounded-retry loop exists to prevent.
 *
 * It was found as a flaky test rather than as a bug report. `client-reconnect.test.ts`'s "a timed-out
 * server is reconnectable on the next request" failed under full-suite load and passed in isolation;
 * its 300ms is deliberate fault injection, and the RECOVERY path was bounded by that same 300ms, so
 * on a loaded host recovery could not fit. Raising the 300ms would have made the suite green while
 * hiding the defect — the one move that must not be made here.
 *
 * ## What this file covers, and what it deliberately does not
 *
 * The RULE — which deadline applies to which call — is a pure function and is tested as one in
 * `tests/internal/mcp/handshake-timeout.test.ts`: no clock, no spawn, no sleep. That is where the
 * clause "a caller who sets a LARGER timeout keeps it" is pinned, and it is a clause every test in
 * THIS file passes while it is broken.
 *
 * What remains here is the WIRING: that the reconnect loop reaches the handshake with
 * `reconnecting === true`, so the rule is consulted at all. A correct rule wired to nothing is the
 * defect this file was written for, and no unit test can see it.
 *
 * ## Why there is no fixed sleep left
 *
 * The previous version had two clock races, and neither was the claim.
 *
 * 1. `requestTimeoutMs: 120` had to be LARGE enough for the first connect to fit a Node process
 *    spawn — measured 2026-09-02 at 16-26ms idle, 39-60ms with all 12 cores saturated. A 2.5x margin
 *    against a cost the test does not control and makes no claim about.
 * 2. The mock answered `initialize` after `setTimeout(reply, 400)`, a fixed sleep, which
 *    CONTRIBUTING.md § What a wait must be forbids: "satisfied by the passage of time, which the code
 *    does not control".
 *
 * Both are gone. {@link REQUEST_BUDGET_MS} is DERIVED from that measurement rather than picked — 16x
 * the worst observed spawn — so the first connect is not a race. And the mock now HOLDS `initialize`
 * until a trigger file appears, so the handshake lasts exactly as long as the test says, with no
 * upper bound to lose against. The test's own wait is a floor over a hold that cannot end on its
 * own, not a bet that one duration beats another.
 *
 * The non-vacuity check is what makes that honest: the mock records how long it actually held, and
 * the test asserts that it exceeded the budget. Without it, a hold that finished early would pass
 * silently and prove nothing.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, onTestFinished } from "vitest";

import { createMcpClient } from "../../src/internal/mcp/client.js";
import { pollUntil } from "../helpers/poll-until.js";
import { removeTempDirRobustSync } from "../helpers/temp-workspace.js";

/**
 * The caller's per-request budget for the reconnect case.
 *
 * DERIVED, not chosen. Spawning this mock and getting `initialize` back was measured at 16-26ms on
 * an idle host and 39-60ms with every core saturated; 1000ms is ~16x the worst of those. The first
 * connect is setup, not the claim, and setup that can lose a race is how a test fails for a reason
 * it does not describe.
 *
 * Raising it costs nothing here, because the handshake it must be exceeded by is held open by a
 * trigger rather than by a timer.
 */
const REQUEST_BUDGET_MS = 1_000;

/**
 * How far PAST the budget the handshake is held.
 *
 * Not cosmetic. Without it the release lands at the same instant the un-floored deadline would fire,
 * and the two outcomes become a coin flip. Half the budget puts the release unambiguously after the
 * cut, so the mutation below dies every time rather than most of the time.
 */
const HOLD_MARGIN_MS = REQUEST_BUDGET_MS / 2;

/**
 * A server whose FIRST spawn answers everything promptly and then exits on `tools/list`, and whose
 * LATER spawns HOLD `initialize` until `unblockFile` appears — then answer, recording how long they
 * held in `heldFile`.
 *
 * That shape reproduces the real sequence: connect cleanly, get dropped mid-request, then have the
 * RECONNECT handshake outlast the caller's request budget. A per-process counter file makes the
 * spawns distinguishable, and the held-duration file is what lets the test prove the handshake
 * really did outlast the budget instead of assuming it.
 */
function dropThenHeldHandshakeScript(files: {
  counter: string;
  unblock: string;
  held: string;
}): string {
  return `
    const fs = require("node:fs");
    let n = 0;
    try { n = parseInt(fs.readFileSync(${JSON.stringify(files.counter)}, "utf8"), 10) || 0; } catch {}
    fs.writeFileSync(${JSON.stringify(files.counter)}, String(n + 1));
    let buf = "";
    process.stdin.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        if (msg.method === "tools/list" && n === 0) { process.exit(0); }
        const reply = () => process.stdout.write(
          JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [] } }) + "\\n");
        if (msg.method === "initialize" && n > 0) {
          // HOLD until the test releases us. No timer: the test decides the duration, so the
          // handshake cannot accidentally finish inside the request budget on a fast host.
          //
          // The release is CONSUMED (unlinked) rather than merely read, so it frees exactly the
          // spawn that was waiting for it. Left in place, a later retry — the one a client with no
          // floor makes after its deadline killed this child — would find the file already there and
          // answer instantly, which is a reconnect the floor had nothing to do with.
          const startedAt = Date.now();
          const waitForRelease = () => {
            if (fs.existsSync(${JSON.stringify(files.unblock)})) {
              try { fs.unlinkSync(${JSON.stringify(files.unblock)}); } catch {}
              fs.writeFileSync(${JSON.stringify(files.held)}, String(Date.now() - startedAt));
              reply();
              return;
            }
            setTimeout(waitForRelease, 5);
          };
          waitForRelease();
        } else reply();
      }
    });
  `;
}

function scriptFile(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "theokit-mcp-handshake-"));
  onTestFinished(() => {
    removeTempDirRobustSync(dir);
  });
  const file = join(dir, "server.cjs");
  writeFileSync(file, source);
  return file;
}

describe("MCP handshake budget", () => {
  it("RECONNECTS when the recovery handshake outlasts a tight requestTimeoutMs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "theokit-mcp-handshake-"));
    onTestFinished(() => {
      removeTempDirRobustSync(dir);
    });
    const files = {
      counter: join(dir, "spawns.txt"),
      unblock: join(dir, "release.txt"),
      held: join(dir, "held-ms.txt"),
    };
    const client = createMcpClient("reconnecting", {
      type: "stdio",
      command: process.execPath,
      args: [scriptFile(dropThenHeldHandshakeScript(files))],
      requestTimeoutMs: REQUEST_BUDGET_MS,
    });
    onTestFinished(async () => {
      await client.close();
    });

    await client.initialize();
    // The first spawn exits on tools/list without replying — a real mid-request drop.
    await expect(client.listTools()).rejects.toMatchObject({ code: "mcp_disconnected" });

    // The next request must recover. Not awaited yet: the reconnect it triggers is what we hold.
    const recovered = client.listTools();

    // Wait on the CODE's own evidence that the reconnect started — a second spawn — rather than on a
    // duration. The reconnect loop backs off before spawning, so this is not immediate.
    await pollUntil(
      () => existsSync(files.counter) && Number(readFileSync(files.counter, "utf8")) >= 2,
      { deadlineMs: 10_000, message: "the reconnect never spawned a second child" },
    );
    const heldFrom = Date.now();

    // Hold PAST the request budget. This is a floor over a wait that cannot end on its own — the
    // mock is blocked on a file that only this line creates — not a bet that one duration beats
    // another. Cost is bounded and deliberate: the hold is exactly as long as this line says.
    await pollUntil(() => Date.now() - heldFrom > REQUEST_BUDGET_MS + HOLD_MARGIN_MS, {
      deadlineMs: (REQUEST_BUDGET_MS + HOLD_MARGIN_MS) * 4,
      intervalMs: 25,
      message: "clock did not advance past the request budget",
    });
    writeFileSync(files.unblock, "go");

    // Bound to the request budget, every one of MAX_RECONNECT_ATTEMPTS would spawn a child that
    // cannot answer in time, the loop would exhaust and the client would surface mcp_disconnected —
    // wedged, which is what the handshake floor exists to prevent.
    await expect(recovered).resolves.toEqual([]);

    // The two assertions divide the claim, and NEITHER is redundant:
    //
    //   the line above  — the client recovered at all
    //   the line below  — the handshake that recovered it outlasted the request budget
    //
    // Only together do they mean "the floor applied". Recovery alone is satisfiable by a handshake
    // that finished inside the budget, which proves nothing; a long hold alone is satisfiable by a
    // client that gave up. Removing the floor from the wiring kills the SECOND one — the mock
    // records a hold far under the budget, because the spawn that answered was a retry that never
    // waited.
    const heldMs = Number(readFileSync(files.held, "utf8"));
    expect(
      heldMs,
      `the reconnect handshake held for ${heldMs}ms, which does not exceed the ` +
        `${REQUEST_BUDGET_MS}ms request budget — this run proved nothing about the floor`,
    ).toBeGreaterThan(REQUEST_BUDGET_MS);
  }, 30_000);

  it("the FIRST connect keeps the caller's budget — the floor is not a global raise", async () => {
    // Deliberately unchanged, and the reason is which failure is visible. A requestTimeoutMs too
    // small to connect at all fails at the call the caller made, immediately, and is theirs to
    // correct. `client-timeout.test.ts` pins it: a silent server rejects within 2s at 150ms. A floor
    // on first connect would make that wait the floor instead.
    const client = createMcpClient("slow-first-connect", {
      type: "stdio",
      command: "sh",
      args: ["-c", "cat >/dev/null"],
      requestTimeoutMs: 100,
    });
    onTestFinished(async () => {
      await client.close();
    });

    const started = Date.now();
    await expect(client.initialize()).rejects.toMatchObject({ code: "mcp_timeout" });
    expect(Date.now() - started).toBeLessThan(3_000);
  }, 30_000);

  it("still bounds an ORDINARY request by requestTimeoutMs — the floor is not a global raise", async () => {
    // The counter-proof. A floor that applied to every method would make `requestTimeoutMs` a
    // suggestion, which is a worse defect than the one being fixed.
    //
    // The oracle is the ERROR, not the clock. A first version asserted elapsed wall time and failed
    // under full-suite load for a reason that had nothing to do with the claim — the connect itself
    // could not fit its own budget on a loaded host. An assertion about "was fast" is the fragile
    // shape; "was cut at the budget it names" is the durable one, and it is also the actual claim.
    const neverAnswersToolsList = `
      let buf = "";
      process.stdin.on("data", (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf("\\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          const msg = JSON.parse(line);
          if (msg.method === "tools/list") continue;
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: {} }) + "\\n");
        }
      });
    `;
    // Generous enough that a loaded host still connects; far below the 10s handshake floor, so a
    // floor leaking onto ordinary methods would be visible in the message below.
    const client = createMcpClient("slow-request", {
      type: "stdio",
      command: process.execPath,
      args: [scriptFile(neverAnswersToolsList)],
      requestTimeoutMs: 2_000,
    });
    onTestFinished(async () => {
      await client.close();
    });

    await client.initialize();
    await expect(client.listTools()).rejects.toMatchObject({
      code: "mcp_timeout",
      // Names 2000, not 10000: the ordinary request was cut at ITS budget.
      message: expect.stringContaining("2000ms"),
    });
  }, 30_000);
});
