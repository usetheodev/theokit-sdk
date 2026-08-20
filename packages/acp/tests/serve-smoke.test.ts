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

const BIN = join(import.meta.dirname, "..", "bin", "theokit-acp.mjs");

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
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
          reject(new Error(`${response.error.code} ${response.error.message}`));
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

  it("initializes, opens a session, prompts, cancels, and shuts down cleanly", async () => {
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
      // 1. initialize
      const init = await client.request<{ protocolVersion: number }>("initialize", {
        protocolVersion: 1,
        clientCapabilities: {},
      });
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
  }, 30_000);

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
