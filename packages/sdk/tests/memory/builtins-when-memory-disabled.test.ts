/**
 * usetheokit/theokit-sdk#381, memory half — are `memory_search` / `memory_get` declared to the model
 * when the agent was built with `memory: { enabled: false }`?
 *
 * The report says yes, measured at 1,462 characters per round against the built `@theokit/sdk@4.53.1`.
 * Read against this tree's source the guard is present — `LocalAgentMemory.ensureTools()` returns
 * `undefined` on `enabled !== true`, and the port adapter's `buildTools()` reads that same warmed
 * cache — so the claim did not reproduce here. That is exactly the kind of "I read the code and it
 * looked right" conclusion this repository does not accept on its own, and it is why this file
 * exists: it MEASURES both entry points instead of arguing about them, so the next reader gets a
 * failing test rather than a paragraph if the guard is ever lost.
 *
 * Anti-vacuity is the whole design here. A test that only asserts "disabled ⇒ no tools" passes just
 * as happily against a memory subsystem that is broken and produces nothing at all — the exact
 * failure that would make the measurement meaningless. Every case is therefore paired with
 * `enabled: true` on the same temp workspace, which must produce both tools.
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, onTestFinished } from "vitest";
import { LocalAgentMemory } from "../../src/internal/local-agent/local-agent-memory.js";
import { createLocalAgentMemoryProvider } from "../../src/internal/local-agent/local-agent-memory-provider.js";
import type { AgentOptions, SDKAgent } from "../../src/types/agent.js";
import { removeTempDirRobust } from "../helpers/temp-workspace.js";

const AGENT_REF = { agentId: "mem-flag", model: { id: "openai/gpt-4o-mini" } } as SDKAgent;

function optionsWithMemory(enabled: boolean | undefined): AgentOptions {
  return (enabled === undefined ? {} : { memory: { enabled } }) as AgentOptions;
}

describe("memory builtins follow the `memory.enabled` flag", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-memory-flag-"));
    const dir = cwd;
    onTestFinished(async () => {
      await removeTempDirRobust(dir);
    });
  });

  it("test_the_legacy_path_builds_both_memory_tools_when_memory_is_enabled", async () => {
    const glue = new LocalAgentMemory(optionsWithMemory(true), cwd, "mem-flag");

    const tools = await glue.ensureTools();

    expect(
      (tools ?? []).map((tool) => tool.name).sort(),
      "the control case must produce the two builtins, or the disabled case below proves nothing",
    ).toEqual(["memory_get", "memory_search"]);
  });

  it("test_the_legacy_path_builds_no_memory_tools_when_memory_is_disabled", async () => {
    const glue = new LocalAgentMemory(optionsWithMemory(false), cwd, "mem-flag");

    const tools = await glue.ensureTools();

    expect(tools, `expected no memory tools, got ${JSON.stringify(tools)}`).toBeUndefined();
  });

  it("test_the_legacy_path_builds_no_memory_tools_when_memory_is_unconfigured", async () => {
    const glue = new LocalAgentMemory(optionsWithMemory(undefined), cwd, "mem-flag");

    const tools = await glue.ensureTools();

    expect(tools).toBeUndefined();
  });

  it("test_the_memory_port_surfaces_both_tools_when_memory_is_enabled", async () => {
    // `THEOKIT_PORT_MEMORY_PATH=1` routes the same subsystem through `MemoryProvider`, whose
    // `buildTools()` result is appended to the loop catalog under `origin: "custom"`. It reads the
    // cache `init()` warmed, so it inherits the flag — asserted rather than assumed.
    const provider = createLocalAgentMemoryProvider({
      agentOptions: optionsWithMemory(true),
      workspaceCwd: cwd,
      agentId: "mem-flag",
    });

    const handle = await provider.init({ cwd });

    expect(
      provider
        .buildTools(handle, AGENT_REF)
        .map((tool) => tool.name)
        .sort(),
    ).toEqual(["memory_get", "memory_search"]);
  });

  it("test_the_memory_port_surfaces_no_tools_when_memory_is_disabled", async () => {
    const provider = createLocalAgentMemoryProvider({
      agentOptions: optionsWithMemory(false),
      workspaceCwd: cwd,
      agentId: "mem-flag",
    });

    const handle = await provider.init({ cwd });

    const names = provider.buildTools(handle, AGENT_REF).map((tool) => tool.name);
    expect(names, `expected no memory tools from the port, got ${names.join(", ")}`).toEqual([]);
  });
});
