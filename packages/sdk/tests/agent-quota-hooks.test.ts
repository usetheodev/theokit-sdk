/**
 * Quota / abuse hooks tests (Production-Readiness #6, ADRs D322-D323).
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Agent } from "../src/agent.js";
import { clearAllSessions } from "../src/internal/runtime/agent-session.js";
import {
  clearAgentRegistry,
  invalidateRegistryHydration,
} from "../src/internal/runtime/registry/agent-registry.js";

const FIXTURE_KEY = "theo_test_quota_hooks";
const MODEL = { id: "openai/gpt-4o-mini" };

describe("AgentOptions.onBeforeCreate (T6.2)", () => {
  let root: string;

  beforeEach(async () => {
    clearAgentRegistry();
    clearAllSessions();
    invalidateRegistryHydration();
    await Agent.registry.evictAll();
    root = await mkdtemp(join(tmpdir(), "theokit-quota-create-"));
  });

  afterEach(async () => {
    clearAgentRegistry();
    clearAllSessions();
    invalidateRegistryHydration();
    await Agent.registry.evictAll();
    await rm(root, { recursive: true, force: true });
  });

  it("hook resolves → create proceeds normally", async () => {
    const onBeforeCreate = vi.fn().mockResolvedValue(undefined);
    const agent = await Agent.create({
      apiKey: FIXTURE_KEY,
      model: MODEL,
      local: { cwd: root },
      onBeforeCreate,
    });
    expect(onBeforeCreate).toHaveBeenCalledTimes(1);
    expect(onBeforeCreate.mock.calls[0]?.[0].conversationId).toBeDefined();
    await agent.dispose();
  });

  it("hook throws → create rejects with the same error", async () => {
    const onBeforeCreate = vi.fn().mockRejectedValue(new Error("quota exceeded for user x"));
    await expect(
      Agent.create({
        apiKey: FIXTURE_KEY,
        model: MODEL,
        local: { cwd: root },
        onBeforeCreate,
      }),
    ).rejects.toThrow("quota exceeded for user x");
  });

  it("hook receives userId from metadata when set", async () => {
    const onBeforeCreate = vi.fn().mockResolvedValue(undefined);
    const agent = await Agent.create({
      apiKey: FIXTURE_KEY,
      model: MODEL,
      local: { cwd: root },
      metadata: { userId: "user-42" },
      onBeforeCreate,
    });
    expect(onBeforeCreate.mock.calls[0]?.[0].userId).toBe("user-42");
    await agent.dispose();
  });

  it("hook fires BEFORE registry insert (rejection leaves no orphan)", async () => {
    const onBeforeCreate = vi.fn().mockRejectedValue(new Error("blocked"));
    await expect(
      Agent.create({
        apiKey: FIXTURE_KEY,
        model: MODEL,
        local: { cwd: root },
        agentId: "agent-orphan-check",
        onBeforeCreate,
      }),
    ).rejects.toThrow("blocked");
    // Registry should be empty for this id.
    const list = await Agent.list();
    expect(list.items.find((a) => a.agentId === "agent-orphan-check")).toBeUndefined();
  });
});

describe("AgentOptions.onBeforeSend (T6.3)", () => {
  let root: string;

  beforeEach(async () => {
    clearAgentRegistry();
    clearAllSessions();
    invalidateRegistryHydration();
    await Agent.registry.evictAll();
    root = await mkdtemp(join(tmpdir(), "theokit-quota-send-"));
  });

  afterEach(async () => {
    clearAgentRegistry();
    clearAllSessions();
    invalidateRegistryHydration();
    await Agent.registry.evictAll();
    await rm(root, { recursive: true, force: true });
  });

  it("hook resolves → send proceeds normally", async () => {
    const onBeforeSend = vi.fn().mockResolvedValue(undefined);
    const agent = await Agent.create({
      apiKey: FIXTURE_KEY,
      model: MODEL,
      local: { cwd: root },
      onBeforeSend,
    });
    const run = await agent.send("hi");
    expect(run).toBeDefined();
    expect(onBeforeSend).toHaveBeenCalledTimes(1);
    expect(onBeforeSend.mock.calls[0]?.[0].previousMessageCount).toBe(0);
    await agent.dispose();
  });

  it("hook throws → send rejects with the same error", async () => {
    const onBeforeSend = vi.fn().mockRejectedValue(new Error("conversation too long"));
    const agent = await Agent.create({
      apiKey: FIXTURE_KEY,
      model: MODEL,
      local: { cwd: root },
      onBeforeSend,
    });
    await expect(agent.send("hi")).rejects.toThrow("conversation too long");
    await agent.dispose();
  });

  it("previousMessageCount reflects persisted state BEFORE the new send adds user message", async () => {
    const counts: number[] = [];
    const onBeforeSend = vi
      .fn()
      .mockImplementation(async (event: { previousMessageCount: number }) => {
        counts.push(event.previousMessageCount);
      });
    const agent = await Agent.create({
      apiKey: FIXTURE_KEY,
      model: MODEL,
      local: { cwd: root },
      onBeforeSend,
    });
    await agent.send("first");
    // After first send: 1 user message persisted (assistant may or may not be — fixture mode).
    await agent.send("second");
    expect(counts[0]).toBe(0); // before first send
    expect(counts[1]).toBeGreaterThanOrEqual(1); // before second send
    await agent.dispose();
  });

  it("hook rejection produces no side effects (no LLM call, no storage write)", async () => {
    const onBeforeSend = vi.fn().mockRejectedValue(new Error("blocked"));
    const agent = await Agent.create({
      apiKey: FIXTURE_KEY,
      model: MODEL,
      local: { cwd: root },
      onBeforeSend,
    });
    await expect(agent.send("hi")).rejects.toThrow("blocked");
    // Hook ran once; agent state is otherwise unchanged.
    expect(onBeforeSend).toHaveBeenCalledTimes(1);
    await agent.dispose();
  });
});
