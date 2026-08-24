/**
 * Tests for createPersonalityResolver (T3.1, ADR D160 + EC-F empty agentId).
 */

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { PersonalityRegistry } from "../../../src/internal/personality/registry.js";
import { createPersonalityResolver } from "../../../src/internal/personality/resolver.js";
import { PersonalityStore } from "../../../src/internal/personality/store.js";
import type { SystemPromptContext } from "../../../src/types/agent.js";
import { removeTempDirRobust } from "../../helpers/temp-workspace.js";

async function buildRegistry(presets: Record<string, string>): Promise<{
  cwd: string;
  registry: PersonalityRegistry;
}> {
  const cwd = await mkdtemp(join(tmpdir(), "theokit-resolver-"));
  const __cwdCleanup1 = cwd;
  onTestFinished(async () => {
    await removeTempDirRobust(__cwdCleanup1);
  });
  const dir = join(cwd, ".theokit/personalities");
  await mkdir(dir, { recursive: true });
  for (const [name, body] of Object.entries(presets)) {
    await writeFile(join(dir, `${name}.md`), `---\nname: ${name}\n---\n${body}`);
  }
  process.env.HOME = "/var/empty";
  const registry = await PersonalityRegistry.load(cwd);
  return { cwd, registry };
}

function makeCtx(overrides?: Partial<SystemPromptContext>): SystemPromptContext {
  return {
    agentId: "agent-x",
    cwd: undefined,
    model: undefined,
    skills: [],
    userMessage: "",
    memory: [],
    ...overrides,
  };
}

describe("createPersonalityResolver (T3.1)", () => {
  let homeBackup: string | undefined;
  beforeEach(() => {
    homeBackup = process.env.HOME;
  });
  afterEach(() => {
    if (homeBackup !== undefined) process.env.HOME = homeBackup;
    else delete process.env.HOME;
    vi.restoreAllMocks();
  });

  it("no active personality returns base unchanged", async () => {
    const { cwd, registry } = await buildRegistry({ coder: "Coder body" });
    const store = new PersonalityStore(cwd);
    const resolver = createPersonalityResolver(registry, store, { baseSystemPrompt: "BASE" });
    expect(await resolver(makeCtx())).toBe("BASE");
  });

  it("active personality overlays body with default separator", async () => {
    const { cwd, registry } = await buildRegistry({ coder: "Coder body" });
    const store = new PersonalityStore(cwd);
    await store.setActive("agent-x", "coder");
    const resolver = createPersonalityResolver(registry, store, { baseSystemPrompt: "BASE" });
    expect(await resolver(makeCtx())).toBe("BASE\n\nCoder body");
  });

  it("custom separator applied", async () => {
    const { cwd, registry } = await buildRegistry({ coder: "Coder body" });
    const store = new PersonalityStore(cwd);
    await store.setActive("agent-x", "coder");
    const resolver = createPersonalityResolver(registry, store, {
      baseSystemPrompt: "BASE",
      separator: " | ",
    });
    expect(await resolver(makeCtx())).toBe("BASE | Coder body");
  });

  it("base as async resolver is awaited", async () => {
    const { cwd, registry } = await buildRegistry({ coder: "Coder body" });
    const store = new PersonalityStore(cwd);
    await store.setActive("agent-x", "coder");
    const resolver = createPersonalityResolver(registry, store, {
      baseSystemPrompt: async () => "ASYNC_BASE",
    });
    expect(await resolver(makeCtx())).toBe("ASYNC_BASE\n\nCoder body");
  });

  it("slug in store but missing from registry warns and drops overlay", async () => {
    const { cwd, registry } = await buildRegistry({ coder: "Coder body" });
    const store = new PersonalityStore(cwd);
    await store.setActive("agent-x", "ghost"); // ghost is not in the registry
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const resolver = createPersonalityResolver(registry, store, { baseSystemPrompt: "BASE" });
    expect(await resolver(makeCtx())).toBe("BASE");
    stderr.mockRestore();
  });

  it("no base returns personality body alone", async () => {
    const { cwd, registry } = await buildRegistry({ poet: "Be poetic" });
    const store = new PersonalityStore(cwd);
    await store.setActive("agent-x", "poet");
    const resolver = createPersonalityResolver(registry, store); // no baseSystemPrompt
    expect(await resolver(makeCtx())).toBe("Be poetic");
  });

  it("EC-11: empty base omits leading separator", async () => {
    const { cwd, registry } = await buildRegistry({ poet: "Be poetic" });
    const store = new PersonalityStore(cwd);
    await store.setActive("agent-x", "poet");
    const resolver = createPersonalityResolver(registry, store, { baseSystemPrompt: "" });
    expect(await resolver(makeCtx())).toBe("Be poetic");
  });

  it("EC-F: empty agentId returns base unchanged", async () => {
    const { cwd, registry } = await buildRegistry({ coder: "Coder body" });
    const store = new PersonalityStore(cwd);
    await store.setActive("agent-x", "coder");
    const resolver = createPersonalityResolver(registry, store, { baseSystemPrompt: "BASE" });
    // Empty agentId — no overlay possible.
    expect(await resolver(makeCtx({ agentId: "" }))).toBe("BASE");
  });

  it("preserves trailing whitespace in body (EC-10)", async () => {
    const { cwd, registry } = await buildRegistry({ coder: "Coder body\n\n" });
    const store = new PersonalityStore(cwd);
    await store.setActive("agent-x", "coder");
    const resolver = createPersonalityResolver(registry, store, { baseSystemPrompt: "BASE" });
    // loadMarkdownEntities preserves body content; trailing newline is preserved.
    const result = await resolver(makeCtx());
    expect(result.startsWith("BASE\n\nCoder body")).toBe(true);
  });
});
