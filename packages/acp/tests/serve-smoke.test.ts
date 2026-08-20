/**
 * Phase 7 (programmatic) — end-to-end serve smoke test.
 *
 * Spawns the bin shim against a fixture agent (which uses fixture-mode
 * SDK so we don't need a live LLM key), drives the ACP JSON-RPC protocol
 * over stdio, asserts:
 *   1. initialize → handshake succeeds with protocolVersion
 *   2. new_session → returns sessionId, agent created
 *   3. prompt → response with stopReason
 *   4. cancel → idempotent (no error response)
 *   5. stdin close → process exits (EC-1 cleanup)
 *
 * Live Zed integration is a manual human task documented in
 * `examples/acp-server/README.md`. This automated smoke exercises the
 * same wire protocol so we get repeatable signal in CI.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ACP_ERR } from "../src/lifecycle.js";

const BIN = join(import.meta.dirname, "..", "bin", "theokit-acp.mjs");

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Preserves the JSON-RPC error's `code` as a typed field (B-138) — the string-concatenated
 *  `Error(\`${code} ${message}\`)` this replaced could only be re-parsed with a regex, which is
 *  exactly the kind of fragile assertion `testing.md § 4.1` asks negative cases to avoid. */
class AcpRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "AcpRpcError";
  }
}

class StdioClient {
  private buffer = "";
  private nextId = 1;
  private pending = new Map<number, (msg: JsonRpcMessage) => void>();
  private notifications: JsonRpcMessage[] = [];

  constructor(
    private stdin: NodeJS.WritableStream,
    stdout: NodeJS.ReadableStream,
  ) {
    stdout.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf-8");
      this.drain();
    });
  }

  private drain(): void {
    let idx = this.buffer.indexOf("\n");
    while (idx !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (line.length > 0) {
        try {
          const msg = JSON.parse(line) as JsonRpcMessage;
          if (msg.id !== undefined && this.pending.has(msg.id)) {
            this.pending.get(msg.id)?.(msg);
            this.pending.delete(msg.id);
          } else {
            this.notifications.push(msg);
          }
        } catch {
          // ignore non-JSON
        }
      }
      idx = this.buffer.indexOf("\n");
    }
  }

  async request<T = unknown>(method: string, params: unknown, timeoutMs = 5000): Promise<T> {
    const id = this.nextId++;
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    this.stdin.write(`${msg}\n`);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, timeoutMs);
      this.pending.set(id, (response) => {
        clearTimeout(timer);
        if (response.error !== undefined) {
          reject(new AcpRpcError(response.error.code, response.error.message));
        } else {
          resolve(response.result as T);
        }
      });
    });
  }

  notify(method: string, params: unknown): void {
    const msg = JSON.stringify({ jsonrpc: "2.0", method, params });
    this.stdin.write(`${msg}\n`);
  }

  collectedNotifications(): JsonRpcMessage[] {
    return [...this.notifications];
  }
}

/**
 * Spawns `theokit-acp` against `entryPath` and returns a connected client plus a `teardown`
 * that closes stdin and waits for exit (falling back to `kill` after 5s), mirroring the
 * shutdown sequence the original smoke test performs inline.
 */
function spawnAcpClient(entryPath: string): { client: StdioClient; teardown: () => Promise<void> } {
  const child = spawn("node", [BIN, "--entry", entryPath, "--permission", "auto"], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, SKIP_OLLAMA_E2E: "1" },
  });
  const client = new StdioClient(child.stdin, child.stdout);
  const teardown = async (): Promise<void> => {
    child.stdin.end();
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      setTimeout(() => {
        child.kill();
        resolve();
      }, 5000);
    });
  };
  return { client, teardown };
}

/**
 * Budget for the `initialize` handshake, which is NOT a per-request budget: it absorbs the child's
 * cold start — `node` booting plus the ACP entry importing its whole module graph, `@theokit/sdk`
 * included — before a single byte of JSON-RPC is answered.
 *
 * Measured 2026-08-20. On an idle machine the handshake completes comfortably inside the 5s
 * per-request default; under `turbo run test` across twelve packages in parallel it exceeded it and
 * failed as "timeout waiting for initialize", while the same file passed 3/3 in isolation. A test
 * that passes alone and fails in the suite is a flaky test, and `rules/testing.md` § 3 calls that a
 * bug rather than a nuisance.
 *
 * Raising the per-request default would have slackened every other assertion in this file, most of
 * which assert that a call fails FAST. Only this one call waits on a process starting, so only this
 * one gets the larger budget.
 */
const HANDSHAKE_TIMEOUT_MS = 20_000;

/**
 * Budget for a whole spawn-based test. It must EXCEED {@link HANDSHAKE_TIMEOUT_MS}, or vitest kills
 * the test first and the failure says "Test timed out" instead of naming the RPC that hung — the
 * package's `testTimeout` is 15s, which is below the handshake budget and would have done exactly
 * that.
 *
 * Applied to EVERY spawning `it` in this file, the wire-flow test included. That one used to carry a
 * hand-written `30_000`, which is above the package default but below its own worst case: handshake
 * (20s) + the prompt's explicit 15s + the 5s teardown fallback is 40s. The test with the longest
 * tail had the smallest margin.
 */
const SPAWN_TEST_TIMEOUT_MS = 45_000;

/**
 * Performs the ACP `initialize` handshake with the cold-start budget above, and RETURNS the response
 * so a caller can still assert on it. A `void` helper would have forced the wire-flow test — which
 * asserts `protocolVersion` — to keep its own bare `client.request("initialize", …)` on
 * `StdioClient.request`'s 5s default, which is the flake this constant exists to remove.
 */
async function handshake(client: StdioClient): Promise<{ protocolVersion: number }> {
  return client.request<{ protocolVersion: number }>(
    "initialize",
    { protocolVersion: 1, clientCapabilities: {} },
    HANDSHAKE_TIMEOUT_MS,
  );
}

/** Awaits `promise`, asserting it rejects with an `AcpRpcError` — never merely "it threw"
 *  (`testing.md § 4.1`) — and returns the error so callers assert its `code` and `message`. */
async function expectAcpError(promise: Promise<unknown>): Promise<AcpRpcError> {
  try {
    const result = await promise;
    throw new Error(
      `expected a JSON-RPC error, but the call succeeded with: ${JSON.stringify(result)}`,
    );
  } catch (err) {
    if (err instanceof AcpRpcError) return err;
    throw err;
  }
}

describe("serve smoke (Phase 7)", () => {
  let workDir: string;
  let entryPath: string;
  let cleanupExtras: string[] = [];

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "acp-smoke-"));
    // The fixture entry has to live inside the workspace tree so that
    // `import "@theokit/sdk"` resolves via the root node_modules; outside
    // the tree (e.g., /tmp) there is no module resolution path.
    entryPath = join(import.meta.dirname, "_smoke-entry.mjs");
    cleanupExtras = [entryPath];
    // Fixture-mode entry: uses `theo_test_*` apiKey so SDK runs without a
    // live LLM. Returns deterministic "fixture response" output.
    writeFileSync(
      entryPath,
      `
import { Agent } from "@theokit/sdk";

export default async (sessionId) => {
  return Agent.create({
    apiKey: "theo_test_acp_smoke",
    model: { id: "openai/gpt-4o-mini" },
    local: { cwd: ${JSON.stringify(workDir)} },
    name: \`acp-smoke-\${sessionId}\`,
  });
};
`,
    );
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
    for (const p of cleanupExtras) rmSync(p, { force: true });
  });

  it(
    "initializes, opens a session, prompts, cancels, and shuts down cleanly",
    async () => {
      const child = spawn("node", [BIN, "--entry", entryPath, "--permission", "auto"], {
        cwd: process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, SKIP_OLLAMA_E2E: "1" },
      });

      const stderrLines: string[] = [];
      child.stderr.on("data", (chunk: Buffer) => {
        stderrLines.push(chunk.toString("utf-8"));
      });

      const client = new StdioClient(child.stdin, child.stdout);

      try {
        // 1. initialize — through `handshake()` for the cold-start budget. This call spawns the same
        //    child and absorbs the same `node` boot + `@theokit/sdk` module graph as the seven tests
        //    below; left on the 5s per-request default it was the one remaining source of the
        //    "timeout waiting for initialize" flake under `turbo run test`.
        const init = await handshake(client);
        expect(init.protocolVersion).toBeTypeOf("number");
        expect(init.protocolVersion).toBeGreaterThan(0);

        // 2. new_session
        const session = await client.request<{ sessionId: string }>("session/new", {
          cwd: workDir,
          mcpServers: [],
        });
        expect(session.sessionId).toMatch(/^[0-9a-f-]{36}$/);

        // 3. prompt — B-112. The smoke test's name and docblock promised "prompt → response with
        //    stopReason" but never sent `session/prompt`; this is the actual wire round-trip. Fixture
        //    mode (`theo_test_*` apiKey, no THEOKIT_API_BASE_URL) makes the run deterministic: it
        //    always finishes, so the mapped stop reason is "end_turn" (prompt-handler.ts's
        //    `mapStopReason`) — never the fabricated fallback B-125 removed.
        const prompted = await client.request<{ stopReason: string }>(
          "session/prompt",
          {
            sessionId: session.sessionId,
            prompt: [{ type: "text", text: "say hello" }],
          },
          15_000,
        );
        expect(prompted.stopReason).toBe("end_turn");

        // 4. cancel — a notification, so the server owes no response to it. Liveness afterwards is
        //    the whole point of the step.
        //
        // B-055. This used to sleep 50ms and infer survival from the absence of a crash. That is an
        // assumption about subprocess scheduling wearing the clothes of an assertion: a server that
        // died at 60ms passed, and a server that was merely slow to start could pass without ever
        // having processed the cancel. Nothing was asserted at all.
        //
        // A follow-up REQUEST is the signal the server itself emits. `session/list` is read-only, so
        // it proves three things the sleep could not: the process is alive, its JSON-RPC loop still
        // answers, and the cancel did not destroy the session (cancel aborts work, it is not a
        // delete). It is also ordered by the transport rather than by the clock — a single stdio
        // stream dispatches the notification before the request that follows it on the wire.
        client.notify("session/cancel", { sessionId: session.sessionId });

        const listed = await client.request<{ sessions: Array<{ sessionId: string }> }>(
          "session/list",
          {},
        );
        expect(
          listed.sessions.map((s) => s.sessionId),
          "the server must still answer after a cancel, with the session intact",
        ).toContain(session.sessionId);
      } finally {
        child.stdin.end();
        await new Promise<void>((resolve) => {
          child.once("exit", () => resolve());
          setTimeout(() => {
            child.kill();
            resolve();
          }, 5000);
        });
      }

      // Server should have logged session creation + cleanup to stderr.
      const stderr = stderrLines.join("");
      expect(stderr).toMatch(/\[acp\] stdin closed; disposing/);
    },
    SPAWN_TEST_TIMEOUT_MS,
  );

  it("rejects invalid entry with non-zero exit", async () => {
    const child = spawn("node", [BIN, "--entry", "/does/not/exist.ts"], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const code = await new Promise<number>((resolve) => {
      child.once("exit", (c) => resolve(c ?? -1));
    });
    expect(code).toBe(2);
  });
});

/**
 * B-138 — the wire-level smoke test above drives `initialize` → `session/new` →
 * `session/prompt` → `session/cancel` → `session/list`, which V8 coverage on the spawned
 * child (parsed by byte offset against `dist/index.js`, same technique the B-137 refutation
 * used) showed executing. The same dump showed `authenticate`, `loadSession` and
 * `unstable_forkSession` never running at all, and the error branch inside `newSession` and
 * `prompt` (the `if ("error" in result) throw new acp.RequestError(...)` block) never running
 * either — the exact mechanism that reports a failed run to the client, which is why B-125
 * (a failure silently reported as `end_turn`) is a defect this file's own error-reporting path
 * could have shipped for a while unnoticed.
 *
 * `unstable_forkSession` (`session/fork` on the wire — established below by reading
 * `@agentclientprotocol/sdk`'s method table) is a deliberate v0.1 placeholder per the inline
 * comment in `lifecycle.ts`'s `handleForkSession`: the SDK's `agent.fork()` is a one-shot
 * sub-run, not a session split, so v0.1 always rejects the operation until v0.2 lands proper
 * forking. That does NOT make it untestable — the parent-session lookup ahead of the deferred
 * rejection is real guard logic with a real accept/reject split (`store.get(sessionId)` found
 * vs not found), so both branches are driven below and each asserts its own distinct error
 * code/message. What is NOT tested is "forking succeeds" — that behavior does not exist yet,
 * and asserting it would be asserting a stub returns a stub.
 */
describe("unexercised RPC surface (B-138)", () => {
  let workDir: string;
  let entryPath: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "acp-smoke-b138-"));
    entryPath = join(import.meta.dirname, "_smoke-entry-b138.mjs");
    // Same fixture-mode entry shape as the describe block above — kept separate so a failure
    // here can't be blamed on file contention with the other describe's beforeEach/afterEach.
    writeFileSync(
      entryPath,
      `
import { Agent } from "@theokit/sdk";

export default async (sessionId) => {
  return Agent.create({
    apiKey: "theo_test_acp_smoke",
    model: { id: "openai/gpt-4o-mini" },
    local: { cwd: ${JSON.stringify(workDir)} },
    name: \`acp-smoke-b138-\${sessionId}\`,
  });
};
`,
    );
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
    rmSync(entryPath, { force: true });
  });

  it(
    "authenticate — the real handler runs and returns the empty success ACP expects",
    async () => {
      const { client, teardown } = spawnAcpClient(entryPath);
      try {
        await handshake(client);
        // D350: auth is deferred to v0.2, so every methodId is accepted the same way. Asserting
        // the exact empty-object response (not merely "it didn't throw") is what a mutant that
        // changed the shape or added a thrown error would fail.
        const result = await client.request("authenticate", { methodId: "none" });
        expect(result).toEqual({});
      } finally {
        await teardown();
      }
    },
    SPAWN_TEST_TIMEOUT_MS,
  );

  it(
    "session/new — an unresolvable cwd drives the newSession error branch, and the client receives the specific JSON-RPC error",
    async () => {
      const { client, teardown } = spawnAcpClient(entryPath);
      try {
        await handshake(client);
        const missingCwd = join(workDir, "does-not-exist");
        const err = await expectAcpError(
          client.request("session/new", { cwd: missingCwd, mcpServers: [] }),
        );
        expect(err.code).toBe(ACP_ERR.INVALID_REQUEST);
        expect(err.message).toBe(`cwd not found: ${missingCwd}`);
      } finally {
        await teardown();
      }
    },
    SPAWN_TEST_TIMEOUT_MS,
  );

  it(
    "session/prompt — an unknown sessionId drives the prompt error branch, and the client receives the specific JSON-RPC error",
    async () => {
      const { client, teardown } = spawnAcpClient(entryPath);
      try {
        await handshake(client);
        const err = await expectAcpError(
          client.request("session/prompt", {
            sessionId: "no-such-session",
            prompt: [{ type: "text", text: "hello" }],
          }),
        );
        expect(err.code).toBe(ACP_ERR.INVALID_SESSION);
        expect(err.message).toBe("unknown session: no-such-session");
      } finally {
        await teardown();
      }
    },
    SPAWN_TEST_TIMEOUT_MS,
  );

  it(
    "session/load — a sessionId already open in this process rejects on the store guard (accepted by the cwd guard first)",
    async () => {
      const { client, teardown } = spawnAcpClient(entryPath);
      try {
        await handshake(client);
        const session = await client.request<{ sessionId: string }>("session/new", {
          cwd: workDir,
          mcpServers: [],
        });
        const err = await expectAcpError(
          client.request("session/load", {
            sessionId: session.sessionId,
            cwd: workDir,
            mcpServers: [],
          }),
        );
        expect(err.code).toBe(ACP_ERR.INVALID_REQUEST);
        expect(err.message).toBe(`session ${session.sessionId} already loaded`);
      } finally {
        await teardown();
      }
    },
    SPAWN_TEST_TIMEOUT_MS,
  );

  it(
    "session/load — a sessionId this process never created passes the store guard and fails at Agent.resume, with the serverless hint attached",
    async () => {
      const { client, teardown } = spawnAcpClient(entryPath);
      try {
        await handshake(client);
        const unknownId = "11111111-1111-4111-8111-111111111111";
        const err = await expectAcpError(
          client.request("session/load", { sessionId: unknownId, cwd: workDir, mcpServers: [] }),
        );
        expect(err.code).toBe(ACP_ERR.INVALID_SESSION);
        expect(err.message).toBe(
          `session not found: ${unknownId} — if running on serverless/multi-host infra, pass ` +
            "conversationStorage to Agent.create (see docs/recipes/conversation-storage-postgres.md)",
        );
      } finally {
        await teardown();
      }
    },
    SPAWN_TEST_TIMEOUT_MS,
  );

  it(
    "session/fork — a parent never loaded in this process rejects on the lookup guard",
    async () => {
      const { client, teardown } = spawnAcpClient(entryPath);
      try {
        await handshake(client);
        const unknownId = "22222222-2222-4222-8222-222222222222";
        const err = await expectAcpError(
          client.request("session/fork", { sessionId: unknownId, cwd: workDir }),
        );
        expect(err.code).toBe(ACP_ERR.INVALID_SESSION);
        expect(err.message).toBe(`parent session not loaded: ${unknownId}`);
      } finally {
        await teardown();
      }
    },
    SPAWN_TEST_TIMEOUT_MS,
  );

  it(
    "session/fork — a real parent PASSES the lookup guard, landing on the documented v0.2 deferral instead of the lookup error",
    async () => {
      const { client, teardown } = spawnAcpClient(entryPath);
      try {
        await handshake(client);
        const session = await client.request<{ sessionId: string }>("session/new", {
          cwd: workDir,
          mcpServers: [],
        });
        const err = await expectAcpError(
          client.request("session/fork", { sessionId: session.sessionId, cwd: workDir }),
        );
        // Distinct from the previous test's INVALID_SESSION: proves the guard let this input
        // through rather than rejecting every input the same way (testing.md § 4.2).
        expect(err.code).toBe(ACP_ERR.INVALID_REQUEST);
        expect(err.message).toBe(
          "session/fork is deferred to @theokit/acp v0.2 — current SDK fork is a one-shot sub-run, not a session split",
        );
      } finally {
        await teardown();
      }
    },
    SPAWN_TEST_TIMEOUT_MS,
  );
});
