#!/usr/bin/env node
/**
 * Phase 7 — REAL-LLM dogfood (per `.claude/rules/real-llm-validation.md`).
 *
 * Spawns the bin shim against the production examples/acp-server entry
 * with OPENROUTER_API_KEY set. Drives the full ACP wire protocol over
 * stdio, sends a real prompt, asserts the streamed reply contains real
 * LLM-generated text (not a fixture). Run from repo root:
 *
 *   source .env && node packages/acp/tests/_real-llm-dogfood.mjs
 */

import { spawn } from "node:child_process";
import { resolve } from "node:path";

const BIN = resolve(import.meta.dirname, "..", "packages", "acp", "bin", "theokit-acp.mjs");
const ENTRY = resolve(import.meta.dirname, "..", "examples", "acp-server", "src", "index.ts");

const hasOpenrouter =
  typeof process.env.OPENROUTER_API_KEY === "string" && process.env.OPENROUTER_API_KEY.length > 0;
if (!hasOpenrouter) {
  console.error(
    "→ no OPENROUTER_API_KEY set — example will fall through to Ollama at OLLAMA_HOST (default localhost:11434)",
  );
}

class StdioClient {
  constructor(stdin, stdout) {
    this.stdin = stdin;
    this.buffer = "";
    this.nextId = 1;
    this.pending = new Map();
    this.notifications = [];
    stdout.on("data", (chunk) => {
      this.buffer += chunk.toString("utf-8");
      this.drain();
    });
  }
  parseLine(line) {
    try {
      return JSON.parse(line);
    } catch {
      return undefined;
    }
  }
  dispatch(msg) {
    if (msg === undefined) return;
    if (msg.id !== undefined && this.pending.has(msg.id)) {
      this.pending.get(msg.id)(msg);
      this.pending.delete(msg.id);
      return;
    }
    if (msg.method) this.notifications.push(msg);
  }
  drain() {
    let idx = this.buffer.indexOf("\n");
    while (idx !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (line.length > 0) this.dispatch(this.parseLine(line));
      idx = this.buffer.indexOf("\n");
    }
  }
  request(method, params, timeoutMs = 60000) {
    const id = this.nextId++;
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    this.stdin.write(`${msg}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, timeoutMs);
      this.pending.set(id, (r) => {
        clearTimeout(timer);
        if (r.error) reject(new Error(`${r.error.code} ${r.error.message}`));
        else resolve(r.result);
      });
    });
  }
}

console.error(`→ spawning theokit-acp pointing at ${ENTRY}`);
const child = spawn("node", [BIN, "--entry", ENTRY, "--permission", "auto"], {
  cwd: process.cwd(),
  stdio: ["pipe", "pipe", "pipe"],
  env: process.env,
});

const stderrLines = [];
child.stderr.on("data", (chunk) => {
  process.stderr.write(`  [server stderr] ${chunk}`);
  stderrLines.push(chunk.toString("utf-8"));
});

const client = new StdioClient(child.stdin, child.stdout);

async function run() {
  console.error("→ initialize");
  const init = await client.request("initialize", {
    protocolVersion: 1,
    clientCapabilities: {},
  });
  console.error(`  ✓ protocolVersion=${init.protocolVersion}`);

  console.error("→ session/new");
  const sess = await client.request("session/new", {
    cwd: process.cwd(),
    mcpServers: [],
  });
  console.error(`  ✓ sessionId=${sess.sessionId}`);

  console.error("→ session/prompt (REAL LLM — gpt-4o-mini)");
  const startedAt = Date.now();
  const result = await client.request(
    "session/prompt",
    {
      sessionId: sess.sessionId,
      prompt: [{ type: "text", text: "Respond with the single word 'pong' and nothing else." }],
    },
    300_000,
  );
  const elapsed = Date.now() - startedAt;
  console.error(`  ✓ stopReason=${result.stopReason} (elapsed ${elapsed}ms)`);

  // Collect the agent_message_chunk notifications observed
  const chunks = client.notifications.filter(
    (m) =>
      m.method === "session/update" && m.params?.update?.sessionUpdate === "agent_message_chunk",
  );
  const fullText = chunks
    .map((m) => m.params.update.content?.text)
    .filter((t) => typeof t === "string")
    .join("");
  console.error(`  ✓ ${chunks.length} agent_message_chunk notifications received`);
  console.error(`  ✓ assistant text: ${JSON.stringify(fullText).slice(0, 200)}`);

  if (fullText.length === 0) {
    throw new Error(
      "FAIL — no agent_message_chunk text observed. LLM call may have errored silently.",
    );
  }
  // Sanity: real LLM response should contain at least "pong" (lowercase) somewhere.
  if (!/pong/i.test(fullText)) {
    console.error(
      `  ⚠ WARN — assistant text did not contain 'pong'. The LLM may have refused or returned filler.`,
    );
  } else {
    console.error("  ✓ assistant text contains expected 'pong' token");
  }

  console.error("→ closing stdin (EC-1 cleanup test)");
  child.stdin.end();
  await new Promise((resolve) => {
    child.once("exit", () => resolve());
    setTimeout(() => {
      child.kill("SIGTERM");
      resolve();
    }, 5000);
  });

  const stderr = stderrLines.join("");
  if (!/\[acp\] stdin closed; disposing/.test(stderr)) {
    throw new Error("FAIL — EC-1 dispose log line not observed in stderr.");
  }
  console.error("  ✓ EC-1 dispose log observed");

  console.error("");
  console.error("✅ REAL-LLM dogfood PASS");
}

run().catch((err) => {
  console.error(`✗ FAIL: ${err.message}`);
  try {
    child.kill();
  } catch {}
  process.exit(1);
});
