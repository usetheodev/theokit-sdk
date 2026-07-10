/**
 * `createInMemoryMarkdownProvider` end-to-end tests (SDK 2.0 Phase 1 /
 * T1.6 — first concrete MemoryProvider impl shipped in @theokit/sdk-memory).
 *
 * Validates the package's working contract:
 *   - init → buildTools → runActivePass → dispose lifecycle
 *   - LLM-facing `memory_remember` tool persists facts via handler
 *   - runActivePass emits `systemPromptAdditions` reflecting stored facts
 *   - dispose clears state (no memory leak)
 *   - MemoryAdapter ops (write / recall / delete) work end-to-end
 */

import type { MemoryFact, MemoryId, SDKAgent } from "@theokit/sdk";
import { createInMemoryMarkdownProvider } from "@theokit/sdk-memory";
import { describe, expect, it } from "vitest";
import { textHandler } from "./_text-handler.js";

const FAKE_AGENT: SDKAgent = { agentId: "test-agent", model: undefined } as SDKAgent;

describe("createInMemoryMarkdownProvider (@theokit/sdk-memory T1.6)", () => {
  it("test_factory_returns_independent_providers", () => {
    const a = createInMemoryMarkdownProvider();
    const b = createInMemoryMarkdownProvider();
    expect(a).not.toBe(b);
  });

  it("test_init_returns_handle_with_namespaced_adapter", async () => {
    const provider = createInMemoryMarkdownProvider();
    const handle = await provider.init({ cwd: "/tmp" });
    expect(handle.adapter).toBeDefined();
    expect(handle.adapter.id).toBe("in-memory-md");
    expect(handle.adapter.isAvailable()).toBe(true);
  });

  it("test_buildTools_exposes_memory_remember_AND_memory_search_tools", async () => {
    // Iter 35: buildTools now surfaces BOTH memory_remember +
    // memory_search. Pin both names so a future refactor can't silently
    // drop either.
    const provider = createInMemoryMarkdownProvider();
    const handle = await provider.init({ cwd: "/tmp" });
    const tools = provider.buildTools(handle, FAKE_AGENT);
    expect(tools.length).toBe(2);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["memory_remember", "memory_search"]);
    // memory_remember (the original — pinned by name + description)
    const remember = tools.find((t) => t.name === "memory_remember");
    expect(remember?.description).toContain("Persist");
    expect(remember?.inputSchema).toMatchObject({
      type: "object",
      properties: { content: { type: "string" } },
      required: ["content"],
    });
  });

  it("test_memory_remember_handler_persists_fact", async () => {
    const provider = createInMemoryMarkdownProvider();
    const handle = await provider.init({ cwd: "/tmp" });
    const tools = provider.buildTools(handle, FAKE_AGENT);
    const rememberTool = tools[0];
    expect(rememberTool).toBeDefined();
    if (rememberTool === undefined) return;
    const result = await textHandler(rememberTool)({ content: "User prefers Python" });
    const parsed = JSON.parse(result) as { ok: boolean; id?: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.id).toMatch(/^in-memory-md:0$/);
  });

  it("test_memory_remember_handler_rejects_empty_content", async () => {
    const provider = createInMemoryMarkdownProvider();
    const handle = await provider.init({ cwd: "/tmp" });
    const tools = provider.buildTools(handle, FAKE_AGENT);
    const rememberTool = tools[0];
    if (rememberTool === undefined) {
      throw new Error("memory_remember tool not found");
    }
    const result = await textHandler(rememberTool)({ content: "" });
    const parsed = JSON.parse(result) as { ok: boolean; error?: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe("empty content");
  });

  it("test_runActivePass_empty_state_returns_empty_facts", async () => {
    const provider = createInMemoryMarkdownProvider();
    const handle = await provider.init({ cwd: "/tmp" });
    const result = await provider.runActivePass(handle, {
      userMessage: "any",
      history: [],
      agentId: "a",
    });
    expect(result.facts.length).toBe(0);
    expect(result.systemPromptAdditions).toBeUndefined();
  });

  it("test_runActivePass_emits_facts_and_system_prompt_additions", async () => {
    const provider = createInMemoryMarkdownProvider();
    const handle = await provider.init({ cwd: "/tmp" });
    // Persist 2 facts via the adapter
    await handle.adapter.write("User likes coffee", { userId: "u1" });
    await handle.adapter.write("User is allergic to peanuts", { userId: "u1" });
    const result = await provider.runActivePass(handle, {
      userMessage: "remind me",
      history: [],
      agentId: "a",
    });
    expect(result.facts.length).toBe(2);
    expect(result.systemPromptAdditions).toContain("Known facts");
    expect(result.systemPromptAdditions).toContain("- User likes coffee");
    expect(result.systemPromptAdditions).toContain("- User is allergic to peanuts");
  });

  it("test_adapter_write_returns_namespaced_id", async () => {
    const provider = createInMemoryMarkdownProvider();
    const handle = await provider.init({ cwd: "/tmp" });
    const id = await handle.adapter.write("a fact", { userId: "u1" });
    expect(String(id)).toMatch(/^in-memory-md:\d+$/);
  });

  it("test_adapter_write_turn_message_array_joins_content", async () => {
    const provider = createInMemoryMarkdownProvider();
    const handle = await provider.init({ cwd: "/tmp" });
    const id = await handle.adapter.write(
      [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
      { userId: "u1" },
    );
    expect(String(id)).toBe("in-memory-md:0");
    const facts = await handle.adapter.recall("any", { userId: "u1" });
    expect(facts[0]?.content).toBe("hi\nhello");
  });

  it("test_adapter_recall_caps_at_k", async () => {
    const provider = createInMemoryMarkdownProvider();
    const handle = await provider.init({ cwd: "/tmp" });
    await handle.adapter.write("fact 1", { userId: "u1" });
    await handle.adapter.write("fact 2", { userId: "u1" });
    await handle.adapter.write("fact 3", { userId: "u1" });
    const top2 = await handle.adapter.recall("query", { userId: "u1" }, 2);
    expect(top2.length).toBe(2);
  });

  it("test_adapter_delete_namespaced_id_removes_fact", async () => {
    const provider = createInMemoryMarkdownProvider();
    const handle = await provider.init({ cwd: "/tmp" });
    const id = await handle.adapter.write("to be deleted", { userId: "u1" });
    let facts = await handle.adapter.recall("q", { userId: "u1" });
    expect(facts.length).toBe(1);
    await handle.adapter.delete(id);
    facts = await handle.adapter.recall("q", { userId: "u1" });
    expect(facts.length).toBe(0);
  });

  it("test_adapter_delete_rejects_foreign_namespace", async () => {
    const provider = createInMemoryMarkdownProvider();
    const handle = await provider.init({ cwd: "/tmp" });
    const foreign = "other-adapter:abc" as MemoryId;
    await expect(handle.adapter.delete(foreign)).rejects.toThrow(/in-memory-md/);
  });

  it("test_dispose_clears_state", async () => {
    const provider = createInMemoryMarkdownProvider();
    const handle = await provider.init({ cwd: "/tmp" });
    await handle.adapter.write("fact 1", { userId: "u1" });
    await handle.adapter.write("fact 2", { userId: "u1" });
    let facts = await handle.adapter.recall("q", { userId: "u1" });
    expect(facts.length).toBe(2);
    provider.dispose(handle);
    facts = await handle.adapter.recall("q", { userId: "u1" });
    expect(facts.length).toBe(0);
  });

  it("test_lifecycle_smoke_end_to_end — init → remember → recall → dispose", async () => {
    const provider = createInMemoryMarkdownProvider();
    const handle = await provider.init({ cwd: "/tmp", embeddingProviderId: "ollama" });
    const tools = provider.buildTools(handle, FAKE_AGENT);
    // Iter 35: buildTools surfaces 2 tools (memory_remember + memory_search).
    expect(tools.length).toBe(2);
    const rememberTool = tools.find((t) => t.name === "memory_remember");
    if (rememberTool === undefined) throw new Error("missing memory_remember tool");

    await textHandler(rememberTool)({ content: "Pet is a corgi named Maple." });
    await textHandler(rememberTool)({ content: "Birthday is in October." });

    const pass = await provider.runActivePass(handle, {
      userMessage: "what do you know about me?",
      history: [],
      agentId: "test-agent",
    });
    expect(pass.facts.length).toBe(2);
    expect(pass.systemPromptAdditions).toContain("corgi named Maple");
    expect(pass.systemPromptAdditions).toContain("October");

    const allFacts: MemoryFact[] = await handle.adapter.recall("query", { userId: "u1" });
    expect(allFacts.length).toBe(2);

    provider.dispose(handle);
    const after = await handle.adapter.recall("query", { userId: "u1" });
    expect(after.length).toBe(0);
  });
});
