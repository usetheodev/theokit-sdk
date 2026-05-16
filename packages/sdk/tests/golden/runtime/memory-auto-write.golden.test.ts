import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Agent } from "../../../src/index.js";
import {
  extractMemoryFact,
  isMemoryWritePrompt,
} from "../../../src/internal/runtime/memory-store.js";

/**
 * Behaviour gate for memory auto-write-on-send (ADR D1/D2 of v1-completeness).
 */

interface Captured {
  body: Record<string, unknown> | undefined;
}

async function startStubAnthropic(): Promise<{
  server: Server;
  url: string;
  captured: Captured;
}> {
  const captured: Captured = { body: undefined };
  const server = createServer(async (req, res) => {
    if (req.url !== "/v1/messages") {
      res.statusCode = 404;
      res.end();
      return;
    }
    captured.body = JSON.parse(await readBody(req)) as Record<string, unknown>;
    res.statusCode = 200;
    res.setHeader("content-type", "text/event-stream");
    const sse = (event: string, data: string): void => {
      res.write(`event: ${event}\ndata: ${data}\n\n`);
    };
    sse("message_start", "{}");
    sse(
      "content_block_delta",
      JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Got it." },
      }),
    );
    sse(
      "message_delta",
      JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    );
    sse("message_stop", "{}");
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  if (typeof addr !== "object" || addr === null) throw new Error("bind failed");
  return { server, url: `http://127.0.0.1:${addr.port}`, captured };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    req.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
    });
    req.on("end", () => resolve(buf));
  });
}

function memoryMdPath(cwd: string): string {
  return join(cwd, ".theokit", "memory", "MEMORY.md");
}

async function readPersistedFacts(cwd: string): Promise<Array<{ text: string }>> {
  try {
    const raw = await readFile(memoryMdPath(cwd), "utf8");
    // Parse `## Facts` section bullets.
    const idx = raw.indexOf("## Facts");
    if (idx === -1) return [];
    const tail = raw.slice(idx + "## Facts".length);
    const next = tail.search(/\n#{1,2}\s/);
    const block = next === -1 ? tail : tail.slice(0, next);
    return block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("- "))
      .map((line) => ({ text: line.slice(2).trim() }));
  } catch {
    return [];
  }
}

describe("isMemoryWritePrompt / extractMemoryFact (shared helpers)", () => {
  it("matches the canonical Remember: form", () => {
    expect(isMemoryWritePrompt("Remember: foo")).toBe(true);
    expect(isMemoryWritePrompt("  Remember: foo")).toBe(true);
    expect(isMemoryWritePrompt("REMEMBER: foo")).toBe(true);
    expect(isMemoryWritePrompt("Please remember foo")).toBe(false);
    expect(isMemoryWritePrompt("What did I ask you to remember?")).toBe(false);
  });

  it("extractMemoryFact strips trailing period", () => {
    expect(extractMemoryFact("Remember: foo.")).toBe("foo");
    expect(extractMemoryFact("Remember: magic-number is 8675309.")).toBe("magic-number is 8675309");
  });

  it("extractMemoryFact returns empty string for whitespace-only fact", () => {
    expect(extractMemoryFact("Remember:    ")).toBe("");
  });
});

describe("LocalAgent.send memory auto-write", () => {
  let cwd: string | undefined;
  let server: Server | undefined;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-memwrite-"));
  });

  afterEach(async () => {
    cwd = undefined;
    if (server !== undefined) {
      await new Promise<void>((r) => server?.close(() => r()));
      server = undefined;
    }
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_BASE_URL;
  });

  async function mountStub(): Promise<Captured> {
    const stub = await startStubAnthropic();
    server = stub.server;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;
    return stub.captured;
  }

  it("persists the Remember: fact on a real-runtime send", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    await mountStub();
    const agent = await Agent.create({
      apiKey: "user-real-memwrite",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd, settingSources: ["project"] },
      memory: { enabled: true },
    });
    await (await agent.send("Remember: magic-number is 8675309.")).wait();
    const facts = await readPersistedFacts(cwd);
    expect(facts).toHaveLength(1);
    expect(facts[0]?.text).toBe("magic-number is 8675309");
  });

  it("recalls the just-written fact within the same send (re-read before assembly)", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const captured = await mountStub();
    const agent = await Agent.create({
      apiKey: "user-real-memwrite-recall",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd, settingSources: ["project"] },
      memory: { enabled: true },
    });
    await (await agent.send("Remember: magic-number is 8675309.")).wait();
    const system = captured.body?.system as string | undefined;
    expect(system).toBeDefined();
    expect(system).toContain("<memory>");
    expect(system).toContain("8675309");
  });

  it("skips persistence when the pattern does not match", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    await mountStub();
    const agent = await Agent.create({
      apiKey: "user-real-memwrite-skip",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd, settingSources: ["project"] },
      memory: { enabled: true },
    });
    await (await agent.send("What's the magic number?")).wait();
    const facts = await readPersistedFacts(cwd);
    expect(facts).toHaveLength(0);
  });

  it("does not crash the run when the memory write fails (safeCall guard)", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    await mountStub();
    // Make .theokit/memory a regular file so mkdir/writeFile under it fails.
    // Hooks/context dirs are elsewhere so initialize() still succeeds.
    const { mkdir: mkdirFn } = await import("node:fs/promises");
    await mkdirFn(join(cwd, ".theokit"), { recursive: true });
    await writeFile(join(cwd, ".theokit", "memory"), "blocker");
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const agent = await Agent.create({
      apiKey: "user-real-memwrite-fail",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd, settingSources: ["project"] },
      memory: { enabled: true },
    });
    const result = await (await agent.send("Remember: foo.")).wait();
    expect(result.status).toBe("finished");
    expect(stderr).toHaveBeenCalled();
    stderr.mockRestore();
  });

  it("skips persistence when the extracted fact is empty (EC-3)", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    await mountStub();
    const agent = await Agent.create({
      apiKey: "user-real-memwrite-empty",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd, settingSources: ["project"] },
      memory: { enabled: true },
    });
    await (await agent.send("Remember:    ")).wait();
    const facts = await readPersistedFacts(cwd);
    expect(facts).toHaveLength(0);
  });

  it("skips persistence when memory is not enabled (EC-4)", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    await mountStub();
    const agent = await Agent.create({
      apiKey: "user-real-memwrite-disabled",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd, settingSources: ["project"] },
      // no memory option
    });
    await (await agent.send("Remember: foo.")).wait();
    const facts = await readPersistedFacts(cwd);
    expect(facts).toHaveLength(0);
  });

  it("writes the fact exactly once in fixture mode (no double-write, EC-2)", async () => {
    if (cwd === undefined) throw new Error("missing workspace");
    const agent = await Agent.create({
      apiKey: "theo_test_memwrite_fixture",
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd, settingSources: ["project"] },
      memory: { enabled: true },
    });
    await (await agent.send("Remember: vitest is the test runner.")).wait();
    const facts = await readPersistedFacts(cwd);
    expect(facts).toHaveLength(1);
    expect(facts[0]?.text).toBe("vitest is the test runner");
  });
});
