import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Agent } from "../../../src/index.js";

/**
 * Behaviour gate for `AgentOptions.systemPrompt` and
 * `SendOptions.systemPrompt`. Stub provider endpoints capture the request
 * body so each priority path is asserted against the actual wire shape.
 */

interface Captured {
  body: Record<string, unknown> | undefined;
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

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  if (typeof addr !== "object" || addr === null) throw new Error("bind failed");
  return `http://127.0.0.1:${addr.port}`;
}

async function startStubAnthropic(): Promise<{ server: Server; url: string; captured: Captured }> {
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
    const sse = (e: string, d: string): void => {
      res.write(`event: ${e}\ndata: ${d}\n\n`);
    };
    sse("message_start", "{}");
    sse(
      "content_block_delta",
      JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "ok" },
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
  return { server, url: await listen(server), captured };
}

async function startStubPaaS(): Promise<{ server: Server; url: string; captured: Captured }> {
  const captured: Captured = { body: undefined };
  const server = createServer(async (req, res) => {
    if (req.url === "/v1/agents" && req.method === "POST") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          agentId: "bc-stub-sp",
          model: { id: "google/gemini-2.0-flash-001" },
        }),
      );
      return;
    }
    if (!req.url?.startsWith("/v1/agents/")) {
      res.statusCode = 404;
      res.end();
      return;
    }
    captured.body = JSON.parse(await readBody(req)) as Record<string, unknown>;
    res.statusCode = 200;
    res.setHeader("content-type", "text/event-stream");
    const send = (e: string, d: Record<string, unknown>): void => {
      res.write(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`);
    };
    send("status", { status: "CREATING" });
    send("assistant", { text: "ok" });
    send("result", { status: "finished", result: "ok" });
    res.end();
  });
  return { server, url: await listen(server), captured };
}

const localBase = {
  apiKey: "user-real-systemprompt",
  model: { id: "claude-sonnet-4-6" },
  local: { cwd: process.cwd() },
} as const;

describe("systemPrompt routing", () => {
  let server: Server | undefined;
  afterEach(async () => {
    if (server !== undefined) {
      await new Promise<void>((r) => server?.close(() => r()));
      server = undefined;
    }
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_BASE_URL;
    delete process.env.THEOKIT_API_BASE_URL;
  });

  async function withAnthropic(): Promise<Captured> {
    const stub = await startStubAnthropic();
    server = stub.server;
    process.env.ANTHROPIC_API_KEY = "sk-stub";
    process.env.ANTHROPIC_API_BASE_URL = stub.url;
    return stub.captured;
  }

  it("threads AgentOptions.systemPrompt (string) into the Anthropic body", async () => {
    const captured = await withAnthropic();
    const agent = await Agent.create({ ...localBase, systemPrompt: "Be terse." });
    await (await agent.send("hi")).wait();
    expect(captured.body?.system).toBe("Be terse.");
  });

  it("threads AgentOptions.systemPrompt (resolver) into the Anthropic body", async () => {
    const captured = await withAnthropic();
    const agent = await Agent.create({
      ...localBase,
      systemPrompt: async (ctx) => `Agent ${ctx.agentId}`,
    });
    await (await agent.send("hi")).wait();
    expect(captured.body?.system).toMatch(/^Agent agent-/);
  });

  it("SendOptions.systemPrompt overrides AgentOptions.systemPrompt", async () => {
    const captured = await withAnthropic();
    const agent = await Agent.create({ ...localBase, systemPrompt: "A" });
    await (await agent.send("hi", { systemPrompt: "B" })).wait();
    expect(captured.body?.system).toBe("B");
  });

  it("omits `system` from the body when neither is set", async () => {
    const captured = await withAnthropic();
    const agent = await Agent.create({ ...localBase });
    await (await agent.send("hi")).wait();
    expect("system" in (captured.body ?? {})).toBe(false);
  });

  it("injects loaded context as a <context> block when context manager is active", async () => {
    const captured = await withAnthropic();
    const cwd = await mkdtemp(join(tmpdir(), "theokit-ctx-inj-"));
    await mkdir(join(cwd, ".theokit"), { recursive: true });
    await writeFile(join(cwd, "facts.md"), "The magic-number is 8675309.\n");
    await writeFile(
      join(cwd, ".theokit", "context.json"),
      JSON.stringify({ sources: [{ name: "facts", path: "facts.md" }] }),
    );
    const agent = await Agent.create({
      apiKey: "user-real-ctx",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd, settingSources: ["project"] },
      context: { manager: "file" },
    });
    await (await agent.send("hi")).wait();
    const system = captured.body?.system as string | undefined;
    expect(system).toBeDefined();
    expect(system).toContain("<context>");
    expect(system).toContain("8675309");
  });

  it("injects loaded skills as a <skills> block", async () => {
    const captured = await withAnthropic();
    const cwd = await mkdtemp(join(tmpdir(), "theokit-skills-inj-"));
    await mkdir(join(cwd, ".theokit", "skills", "code-review"), { recursive: true });
    await mkdir(join(cwd, ".theokit", "skills", "doc-writer"), { recursive: true });
    await writeFile(
      join(cwd, ".theokit", "skills", "code-review", "SKILL.md"),
      `---\nname: code-review\ndescription: Review TS diffs for type safety\n---\n\nBody`,
    );
    await writeFile(
      join(cwd, ".theokit", "skills", "doc-writer", "SKILL.md"),
      `---\nname: doc-writer\ndescription: Produce concise developer docs\n---\n\nBody`,
    );
    const agent = await Agent.create({
      apiKey: "user-real-skills",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd, settingSources: ["project"] },
    });
    await (await agent.send("hi")).wait();
    const system = captured.body?.system as string | undefined;
    expect(system).toContain("<skills>");
    expect(system).toContain("code-review:");
    expect(system).toContain("doc-writer:");
  });

  it("places <skills> before the resolver-produced base prompt", async () => {
    const captured = await withAnthropic();
    const cwd = await mkdtemp(join(tmpdir(), "theokit-skills-resolver-"));
    await mkdir(join(cwd, ".theokit", "skills", "doc-writer"), { recursive: true });
    await writeFile(
      join(cwd, ".theokit", "skills", "doc-writer", "SKILL.md"),
      `---\nname: doc-writer\ndescription: docs\n---\n\nBody`,
    );
    const agent = await Agent.create({
      apiKey: "user-real-skills-resolver",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd, settingSources: ["project"] },
      systemPrompt: "Be terse.",
    });
    await (await agent.send("hi")).wait();
    const system = captured.body?.system as string;
    const skillsIdx = system.indexOf("<skills>");
    const baseIdx = system.indexOf("Be terse.");
    expect(skillsIdx).toBeGreaterThanOrEqual(0);
    expect(baseIdx).toBeGreaterThan(skillsIdx);
  });

  it("injects persisted memory facts as a <memory> block", async () => {
    const captured = await withAnthropic();
    const cwd = await mkdtemp(join(tmpdir(), "theokit-mem-inj-"));
    await mkdir(join(cwd, ".theokit", "memory", "default"), { recursive: true });
    await writeFile(
      join(cwd, ".theokit", "memory", "default", "agent-default.json"),
      JSON.stringify({ facts: [{ text: "Magic-number is 8675309." }] }),
    );
    const agent = await Agent.create({
      apiKey: "user-real-memory",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd, settingSources: ["project"] },
      memory: { enabled: true },
    });
    await (await agent.send("what's the number?")).wait();
    const system = captured.body?.system as string | undefined;
    expect(system).toContain("<memory>");
    expect(system).toContain("8675309");
  });

  it("recovers from a corrupt memory file with no memory block (EC-4)", async () => {
    const captured = await withAnthropic();
    const cwd = await mkdtemp(join(tmpdir(), "theokit-mem-corrupt-"));
    await mkdir(join(cwd, ".theokit", "memory", "default"), { recursive: true });
    await writeFile(
      join(cwd, ".theokit", "memory", "default", "agent-default.json"),
      "{not valid json",
    );
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const agent = await Agent.create({
      apiKey: "user-real-memory-corrupt",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd, settingSources: ["project"] },
      memory: { enabled: true },
    });
    const result = await (await agent.send("hi")).wait();
    expect(result.status).toBe("finished");
    const system = captured.body?.system as string | undefined;
    expect(system === undefined || !system.includes("<memory>")).toBe(true);
    stderr.mockRestore();
  });

  it("omits system when no context AND no resolved base prompt", async () => {
    const captured = await withAnthropic();
    const agent = await Agent.create({ ...localBase });
    await (await agent.send("hi")).wait();
    expect("system" in (captured.body ?? {})).toBe(false);
  });

  it("includes systemPrompt in the cloud Run POST body (EC-1 / ADR D7)", async () => {
    const stub = await startStubPaaS();
    server = stub.server;
    process.env.THEOKIT_API_BASE_URL = stub.url;
    const agent = await Agent.create({
      apiKey: "user-real-cloud-systemprompt",
      model: { id: "google/gemini-2.0-flash-001" },
      cloud: { repos: [{ url: "https://github.com/usetheo/example" }] },
      systemPrompt: "Cloud agent persona.",
    });
    await (await agent.send("hello cloud")).wait();
    expect(stub.captured.body?.systemPrompt).toBe("Cloud agent persona.");
  });
});
