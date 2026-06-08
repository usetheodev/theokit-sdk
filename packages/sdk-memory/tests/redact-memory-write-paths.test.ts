/**
 * sdk-memory write-path secret redaction tests (iter 43).
 *
 * Validates that:
 *   - `memory_remember` LLM tool redacts content before storing in Map.
 *   - `MemoryAdapter.write` redacts content before storing in Map.
 *
 * Both paths flow into the SAME state.facts Map. Without redaction at
 * EITHER entry point, secrets would leak into subsequent
 * `runActivePass` calls' systemPromptAdditions.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createInMemoryMarkdownProvider } from "@theokit/sdk-memory";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const FAKE_AGENT = { agentId: "test-agent", model: undefined } as never;

describe("sdk-memory write-path redaction (iter 43)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "sdk-memory-redact-write-"));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("test_memory_remember_tool_redacts_secret_before_storing", async () => {
    const provider = createInMemoryMarkdownProvider();
    const handle = await provider.init({ cwd });
    const tools = provider.buildTools(handle, FAKE_AGENT);
    const remember = tools.find((t) => t.name === "memory_remember");
    if (remember === undefined) throw new Error("missing memory_remember");

    const FAKE_KEY = "sk-proj-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    await remember.handler({
      content: `user's API key is ${FAKE_KEY}`,
    });

    // Probe the in-process state via runActivePass — the recalled fact
    // must NOT contain the raw key.
    const pass = await provider.runActivePass(handle, {
      userMessage: "api key",
      history: [],
      agentId: "test-agent",
    });
    const additions = pass.systemPromptAdditions ?? "";
    expect(additions).not.toContain(FAKE_KEY);
    // The framing text survives — confirms content is present, just redacted.
    expect(pass.facts.length).toBe(1);
    expect(pass.facts[0]?.content).toContain("user's API key is");
  });

  it("test_MemoryAdapter_write_redacts_secret_before_storing", async () => {
    const provider = createInMemoryMarkdownProvider();
    const handle = await provider.init({ cwd });

    const FAKE_KEY = "sk-ant-api03-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
    await handle.adapter.write(`anthropic key: ${FAKE_KEY}`, { userId: "u1" });

    // Probe via runActivePass — same Map, same expectations.
    const pass = await provider.runActivePass(handle, {
      userMessage: "anthropic key",
      history: [],
      agentId: "test-agent",
    });
    const additions = pass.systemPromptAdditions ?? "";
    expect(additions).not.toContain(FAKE_KEY);
  });

  it("test_non_secret_content_passes_through_unchanged_in_remember_tool", async () => {
    const provider = createInMemoryMarkdownProvider();
    const handle = await provider.init({ cwd });
    const tools = provider.buildTools(handle, FAKE_AGENT);
    const remember = tools.find((t) => t.name === "memory_remember");
    if (remember === undefined) throw new Error("missing");

    await remember.handler({ content: "user's birthday is in October" });

    const pass = await provider.runActivePass(handle, {
      userMessage: "birthday",
      history: [],
      agentId: "test-agent",
    });
    expect(pass.facts[0]?.content).toBe("user's birthday is in October");
  });

  it("test_redaction_at_BOTH_LLM_tool_AND_adapter_write_in_same_session", async () => {
    const provider = createInMemoryMarkdownProvider();
    const handle = await provider.init({ cwd });
    const tools = provider.buildTools(handle, FAKE_AGENT);
    const remember = tools.find((t) => t.name === "memory_remember");
    if (remember === undefined) throw new Error("missing");

    const KEY_A = "sk-proj-CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
    const KEY_B = "sk-proj-DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";

    // Path A: LLM tool
    await remember.handler({ content: `key A is ${KEY_A}` });
    // Path B: direct adapter.write
    await handle.adapter.write(`key B is ${KEY_B}`, { userId: "u1" });

    const pass = await provider.runActivePass(handle, {
      userMessage: "key",
      history: [],
      agentId: "test-agent",
    });
    const additions = pass.systemPromptAdditions ?? "";
    expect(additions).not.toContain(KEY_A);
    expect(additions).not.toContain(KEY_B);
    expect(pass.facts.length).toBe(2);
  });
});
