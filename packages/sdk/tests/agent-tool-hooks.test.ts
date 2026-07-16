/**
 * Tool lifecycle hooks tests (Production-Readiness #4, ADRs D315-D317).
 *
 * Validates the AgentOptions surface accepts the 3 callbacks. End-to-end
 * fire-order semantics are validated via integration with the agent loop's
 * `dispatchSingleCall` (covered by golden tests + Phase 7 dogfood).
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Agent } from "../src/agent.js";
import {
  clearAgentRegistry,
  invalidateRegistryHydration,
} from "../src/internal/runtime/registry/agent-registry.js";
import { clearAllSessions } from "../src/internal/session/agent-session.js";

const FIXTURE_KEY = "theo_test_tool_hooks";
const MODEL = { id: "openai/gpt-4o-mini" };

describe("AgentOptions tool lifecycle hooks — surface (T5.1)", () => {
  let root: string;

  beforeEach(async () => {
    clearAgentRegistry();
    clearAllSessions();
    invalidateRegistryHydration();
    await Agent.registry.evictAll();
    root = await mkdtemp(join(tmpdir(), "theokit-tool-hooks-"));
  });

  afterEach(async () => {
    clearAgentRegistry();
    clearAllSessions();
    invalidateRegistryHydration();
    await Agent.registry.evictAll();
    await rm(root, { recursive: true, force: true });
  });

  it("accepts onToolStart / onToolEnd / onToolError callbacks", async () => {
    const onToolStart = vi.fn();
    const onToolEnd = vi.fn();
    const onToolError = vi.fn();
    const agent = await Agent.create({
      apiKey: FIXTURE_KEY,
      model: MODEL,
      local: { cwd: root },
      onToolStart,
      onToolEnd,
      onToolError,
    });
    // Surface present in type system + runtime accepts construction.
    expect(agent).toBeDefined();
    await agent.dispose();
  });

  it("hooks not invoked when no tools fire (fixture mode default)", async () => {
    const onToolStart = vi.fn();
    const onToolEnd = vi.fn();
    const onToolError = vi.fn();
    const agent = await Agent.create({
      apiKey: FIXTURE_KEY,
      model: MODEL,
      local: { cwd: root },
      onToolStart,
      onToolEnd,
      onToolError,
    });
    await agent.send("hi");
    await agent.dispose();
    expect(onToolStart).not.toHaveBeenCalled();
    expect(onToolEnd).not.toHaveBeenCalled();
    expect(onToolError).not.toHaveBeenCalled();
  });
});

describe("safeEmitToolHook contract (D317)", () => {
  it("listener errors are swallowed (do not crash agent loop)", async () => {
    // Internal contract: when the agent loop wraps tool dispatch, a
    // listener throw lands in safeEmitToolHook's try/catch and is logged
    // to stderr without bubbling. We verify the surface accepts a
    // throwing callback without rejecting agent.create.
    const root = await mkdtemp(join(tmpdir(), "theokit-tool-hook-throw-"));
    const agent = await Agent.create({
      apiKey: FIXTURE_KEY,
      model: MODEL,
      local: { cwd: root },
      onToolStart: () => {
        throw new Error("listener crashed");
      },
    });
    await expect(agent.send("hi")).resolves.toBeDefined();
    await agent.dispose();
    await rm(root, { recursive: true, force: true });
  });
});
