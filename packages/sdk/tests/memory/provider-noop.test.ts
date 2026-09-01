/**
 * `NoopMemoryProvider` reference impl tests (SDK 2.0 Phase 1 /
 * T1.2 — mirrors `budget-tracker-counter.test.ts` iter 11).
 *
 * Goal: lock the degenerate behavior so consumers can rely on it as a
 * fallback (no provider installed) AND as a worked example before
 * authoring custom providers.
 */

import type { MemoryProvider, MemoryProviderHandle, SDKAgent } from "@theokit/sdk";
import { NoopMemoryProvider } from "@theokit/sdk";
import { describe, expect, it } from "vitest";

describe("NoopMemoryProvider (Phase 1 / T1.2)", () => {
  it("test_factory_returns_fresh_instance — independent per call", () => {
    const a = NoopMemoryProvider.create();
    const b = NoopMemoryProvider.create();
    expect(a).not.toBe(b);
    // Same shape, different identities.
    expect(typeof a.init).toBe("function");
    expect(typeof b.init).toBe("function");
  });

  it("test_init_returns_handle_with_adapter — adapter satisfies MemoryAdapter shape", async () => {
    const provider = NoopMemoryProvider.create();
    const handle = await provider.init({ cwd: "/tmp" });
    expect(handle.adapter).toBeDefined();
    expect(handle.adapter.id).toBe("noop");
    expect(handle.adapter.isAvailable()).toBe(true);
    // All capabilities false.
    for (const v of Object.values(handle.adapter.capabilities)) {
      expect(v).toBe(false);
    }
  });

  it("test_init_idempotent_fresh_handle — subsequent calls return new handles", async () => {
    const provider = NoopMemoryProvider.create();
    const h1 = await provider.init({ cwd: "/tmp" });
    const h2 = await provider.init({ cwd: "/tmp" });
    expect(h1).not.toBe(h2);
    // Both adapters return the same noop id under write.
    expect(await h1.adapter.write("x", { userId: "u1" })).toBe("noop:noop");
    expect(await h2.adapter.write("x", { userId: "u1" })).toBe("noop:noop");
  });

  it("test_buildTools_returns_empty_array — no LLM-facing memory tools", async () => {
    const provider = NoopMemoryProvider.create();
    const handle = await provider.init({ cwd: "/tmp" });
    const tools = provider.buildTools(handle, {} as SDKAgent);
    expect(tools.length).toBe(0);
    expect(Array.isArray(tools)).toBe(true);
  });

  it("test_runActivePass_returns_empty_facts — no recall fires", async () => {
    const provider = NoopMemoryProvider.create();
    const handle = await provider.init({ cwd: "/tmp" });
    const result = await provider.runActivePass(handle, {
      userMessage: "what's my preference?",
      history: [],
      agentId: "agent-x",
    });
    expect(result.facts.length).toBe(0);
    expect(result.systemPromptAdditions).toBeUndefined();
    expect(result.breakerTripped).toBeUndefined();
  });

  it("test_dispose_is_noop — returns void synchronously", async () => {
    const provider = NoopMemoryProvider.create();
    const handle = await provider.init({ cwd: "/tmp" });
    expect(provider.dispose(handle)).toBeUndefined();
  });

  it("test_adapter_recall_returns_empty — no facts surfaced", async () => {
    const provider = NoopMemoryProvider.create();
    const handle = await provider.init({ cwd: "/tmp" });
    const facts = await handle.adapter.recall("query", { userId: "u1" }, 10);
    expect(facts).toEqual([]);
  });

  it("test_adapter_delete_resolves_undefined — no error on unknown id", async () => {
    const provider = NoopMemoryProvider.create();
    const handle = await provider.init({ cwd: "/tmp" });
    await expect(handle.adapter.delete("noop:anything" as never)).resolves.toBeUndefined();
  });

  it("test_lifecycle_smoke — init → buildTools → runActivePass → dispose chain", async () => {
    const provider: MemoryProvider = NoopMemoryProvider.create();
    const handle: MemoryProviderHandle = await provider.init({
      cwd: "/tmp",
      embeddingProviderId: "openai",
    });
    const tools = provider.buildTools(handle, {} as SDKAgent);
    const passResult = await provider.runActivePass(handle, {
      userMessage: "hi",
      history: [{ role: "user", content: "hello" }],
      agentId: "agent-y",
    });
    await provider.dispose(handle);

    expect(tools.length).toBe(0);
    expect(passResult.facts.length).toBe(0);
  });
});
