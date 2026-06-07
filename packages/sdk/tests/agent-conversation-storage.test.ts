/**
 * Agent.create / Agent.resume — conversationStorage wiring tests.
 *
 * Covers Production-Readiness #1 T1.5 + EC-3 (D325): the registry marker
 * `requiresCustomStorage` makes resume strict — preventing silent FS
 * fallback that would lose Postgres/Redis history.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Agent } from "../src/agent.js";
import { FileSystemConversationStorage } from "../src/internal/persistence/conversation-storage-fs.js";
import { InMemoryConversationStorage } from "../src/internal/persistence/conversation-storage-memory.js";
import { clearAllSessions } from "../src/internal/runtime/agent-session.js";
import {
  clearAgentRegistry,
  getRegisteredAgent,
  invalidateRegistryHydration,
} from "../src/internal/runtime/registry/agent-registry.js";

const FIXTURE_KEY = "theo_test_conversation_storage";
const MODEL = { id: "openai/gpt-4o-mini" };

describe("AgentOptions.conversationStorage wiring", () => {
  let root: string;

  beforeEach(async () => {
    clearAgentRegistry();
    clearAllSessions();
    invalidateRegistryHydration();
    root = await mkdtemp(join(tmpdir(), "theokit-conv-wiring-"));
  });

  afterEach(async () => {
    clearAgentRegistry();
    clearAllSessions();
    invalidateRegistryHydration();
    await rm(root, { recursive: true, force: true });
  });

  it("Agent.create without conversationStorage works (backcompat, no marker)", async () => {
    const agent = await Agent.create({
      apiKey: FIXTURE_KEY,
      model: MODEL,
      agentId: "agent-nostore",
      local: { cwd: root },
    });
    try {
      const entry = getRegisteredAgent("agent-nostore");
      expect(entry).toBeDefined();
      expect(entry?.requiresCustomStorage).toBeUndefined();
    } finally {
      await agent.dispose();
    }
  });

  it("Agent.create with custom conversationStorage sets the marker (EC-3)", async () => {
    const storage = new InMemoryConversationStorage();
    const agent = await Agent.create({
      apiKey: FIXTURE_KEY,
      model: MODEL,
      agentId: "agent-mem",
      local: { cwd: root },
      conversationStorage: storage,
    });
    try {
      const entry = getRegisteredAgent("agent-mem");
      expect(entry?.requiresCustomStorage).toBe(true);
    } finally {
      await agent.dispose();
    }
  });

  it("Agent.resume without storage when marker absent uses default FS (backcompat)", async () => {
    const first = await Agent.create({
      apiKey: FIXTURE_KEY,
      model: MODEL,
      agentId: "agent-bc-resume",
      local: { cwd: root },
    });
    await first.dispose();

    // Resume without conversationStorage — should succeed (no marker).
    const resumed = await Agent.resume("agent-bc-resume", { local: { cwd: root } });
    expect(resumed.agentId).toBe("agent-bc-resume");
    await resumed.dispose();
  });

  it("Agent.resume without storage when marker present THROWS (EC-3)", async () => {
    const storage = new InMemoryConversationStorage();
    const first = await Agent.create({
      apiKey: FIXTURE_KEY,
      model: MODEL,
      agentId: "agent-strict-resume",
      local: { cwd: root },
      conversationStorage: storage,
    });
    await first.dispose();

    // Resume WITHOUT passing storage → must throw ConfigurationError(code: "conversation_storage_required")
    await expect(
      Agent.resume("agent-strict-resume", { local: { cwd: root } }),
    ).rejects.toMatchObject({
      name: "ConfigurationError",
      code: "conversation_storage_required",
    });
  });

  it("Agent.resume with storage passed again succeeds when marker present (EC-3)", async () => {
    const storage = new InMemoryConversationStorage();
    const first = await Agent.create({
      apiKey: FIXTURE_KEY,
      model: MODEL,
      agentId: "agent-pass-again",
      local: { cwd: root },
      conversationStorage: storage,
    });
    await first.dispose();

    const resumed = await Agent.resume("agent-pass-again", {
      local: { cwd: root },
      conversationStorage: storage,
    });
    expect(resumed.agentId).toBe("agent-pass-again");
    await resumed.dispose();
  });

  it("FileSystemConversationStorage explicit param works equivalently to default", async () => {
    const storage = new FileSystemConversationStorage({ root });
    const agent = await Agent.create({
      apiKey: FIXTURE_KEY,
      model: MODEL,
      agentId: "agent-fs-explicit",
      local: { cwd: root },
      conversationStorage: storage,
    });
    try {
      // Marker IS set even for FS adapter — strict resume because caller
      // explicitly passed an adapter (intent to be explicit).
      const entry = getRegisteredAgent("agent-fs-explicit");
      expect(entry?.requiresCustomStorage).toBe(true);
    } finally {
      await agent.dispose();
    }
  });
});
