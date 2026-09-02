/**
 * T3.2 — `Agent.usePersonality` public API integration tests
 * (ADRs D160-D164 + EC-J persistent-clear round-trip).
 *
 * Uses fixture mode (no LLM on the wire). Asserts the activation
 * + clearing + cache-invalidation + persistence contract.
 */

import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { Agent } from "../src/agent.js";
import { ConfigurationError } from "../src/errors.js";
import { removeTempDirRobust, useTempCwd } from "./helpers/temp-workspace.js";

// This file creates agents without naming a cwd — `local: {}` and an omitted `local` both fall
// back to process.cwd(), which during a test run is the package itself, so the sessions landed
// in packages/sdk/.theokit/. See useTempCwd's docblock for the 540 MB that bought.
useTempCwd();

async function buildWorkspace(presets: Record<string, string> = {}): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "theokit-personality-api-"));
  const __cwdCleanup1 = cwd;
  onTestFinished(async () => {
    await removeTempDirRobust(__cwdCleanup1);
  });
  const dir = join(cwd, ".theokit/personalities");
  await mkdir(dir, { recursive: true });
  for (const [name, body] of Object.entries(presets)) {
    await writeFile(join(dir, `${name}.md`), `---\nname: ${name}\n---\n${body}`);
  }
  return cwd;
}

describe("Agent.usePersonality (T3.2)", () => {
  let envBackup: { home: string | undefined; theokitHome: string | undefined };
  beforeEach(() => {
    envBackup = {
      home: process.env.HOME,
      theokitHome: process.env.THEOKIT_HOME,
    };
    process.env.HOME = "/var/empty";
    delete process.env.THEOKIT_HOME;
  });
  afterEach(() => {
    if (envBackup.home !== undefined) process.env.HOME = envBackup.home;
    else delete process.env.HOME;
    if (envBackup.theokitHome !== undefined) process.env.THEOKIT_HOME = envBackup.theokitHome;
    else delete process.env.THEOKIT_HOME;
    vi.restoreAllMocks();
  });

  it("activates a preset and returns the resolved object", async () => {
    const cwd = await buildWorkspace({ coder: "Be a coder" });
    const agent = await Agent.create({
      apiKey: "theo_test_x",
      model: { id: "openai/gpt-4o-mini" },
      local: { cwd },
    });
    const preset = await agent.usePersonality?.("coder");
    expect(preset?.name).toBe("coder");
    expect(preset?.systemPrompt).toBe("Be a coder");
    await agent.dispose();
  });

  it("`none` clears active and returns null", async () => {
    const cwd = await buildWorkspace({ coder: "Be a coder" });
    const agent = await Agent.create({
      apiKey: "theo_test_x",
      model: { id: "openai/gpt-4o-mini" },
      local: { cwd },
    });
    await agent.usePersonality?.("coder");
    const result = await agent.usePersonality?.("none");
    expect(result).toBeNull();
    await agent.dispose();
  });

  it("`default` is also a reserved clear alias", async () => {
    const cwd = await buildWorkspace({ coder: "Be a coder" });
    const agent = await Agent.create({
      apiKey: "theo_test_x",
      model: { id: "openai/gpt-4o-mini" },
      local: { cwd },
    });
    await agent.usePersonality?.("coder");
    const result = await agent.usePersonality?.("default");
    expect(result).toBeNull();
    await agent.dispose();
  });

  it("`neutral` is also a reserved clear alias", async () => {
    const cwd = await buildWorkspace({ coder: "Be a coder" });
    const agent = await Agent.create({
      apiKey: "theo_test_x",
      model: { id: "openai/gpt-4o-mini" },
      local: { cwd },
    });
    await agent.usePersonality?.("coder");
    const result = await agent.usePersonality?.("neutral");
    expect(result).toBeNull();
    await agent.dispose();
  });

  it("unknown preset throws ConfigurationError (EC-12)", async () => {
    const cwd = await buildWorkspace({ coder: "Be a coder" });
    const agent = await Agent.create({
      apiKey: "theo_test_x",
      model: { id: "openai/gpt-4o-mini" },
      local: { cwd },
    });
    await expect(agent.usePersonality?.("ghost")).rejects.toBeInstanceOf(ConfigurationError);
    await agent.dispose();
  });

  it("invalidates cache via D94 deferred semantics", async () => {
    const cwd = await buildWorkspace({ coder: "Be a coder" });
    const agent = await Agent.create({
      apiKey: "theo_test_x",
      model: { id: "openai/gpt-4o-mini" },
      local: { cwd },
    });
    expect(typeof agent.invalidateCache).toBe("function");
    const spy = vi.spyOn(agent, "invalidateCache");
    await agent.usePersonality?.("coder");
    expect(spy).toHaveBeenCalledWith("personality-switch");
    await agent.dispose();
  });

  it("save:true persists to disk under THEOKIT_HOME", async () => {
    const cwd = await buildWorkspace({ poet: "Be poetic" });
    const agent = await Agent.create({
      apiKey: "theo_test_x",
      model: { id: "openai/gpt-4o-mini" },
      local: { cwd },
      agentId: "agent-persist",
    });
    await agent.usePersonality?.("poet", { save: true });
    await agent.dispose();

    // Verify persistent JSON wrote the slug under the right agentId.
    const file = join(cwd, ".theokit", "personality.json");
    const json = JSON.parse(await readFile(file, "utf8")) as {
      version: number;
      agents: Record<string, string>;
    };
    expect(json.agents["agent-persist"]).toBe("poet");
  });

  it("returns the preset object on activation, null on clear", async () => {
    const cwd = await buildWorkspace({ coder: "Be a coder" });
    const agent = await Agent.create({
      apiKey: "theo_test_x",
      model: { id: "openai/gpt-4o-mini" },
      local: { cwd },
    });
    const activated = await agent.usePersonality?.("coder");
    expect(activated).not.toBeNull();
    const cleared = await agent.usePersonality?.("none");
    expect(cleared).toBeNull();
    await agent.dispose();
  });

  it("EC-J: clear with save after previous save removes persistent entry", async () => {
    const cwd = await buildWorkspace({ coder: "Be a coder" });
    const agent = await Agent.create({
      apiKey: "theo_test_x",
      model: { id: "openai/gpt-4o-mini" },
      local: { cwd },
      agentId: "agent-ec-j",
    });
    // 1. Save active.
    await agent.usePersonality?.("coder", { save: true });
    // 2. Clear with save.
    await agent.usePersonality?.("none", { save: true });
    await agent.dispose();

    const file = join(cwd, ".theokit", "personality.json");
    const raw = await readFile(file, "utf8");
    const json = JSON.parse(raw) as { agents: Record<string, string | null> };
    expect(json.agents).not.toHaveProperty("agent-ec-j");
    expect(raw).not.toMatch(/"agent-ec-j"\s*:\s*null/);
  });
});
