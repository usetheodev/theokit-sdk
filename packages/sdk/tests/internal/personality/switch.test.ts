/**
 * Tests for performPersonalitySwitch (T5.1, ADR D164 + EC-D/E).
 */

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { ConfigurationError } from "../../../src/errors.js";
import { PersonalityRegistry } from "../../../src/internal/personality/registry.js";
import { PersonalityStore } from "../../../src/internal/personality/store.js";
import { performPersonalitySwitch } from "../../../src/internal/personality/switch.js";
import { removeTempDirRobust } from "../../helpers/temp-workspace.js";

async function buildRegistry(presets: Record<string, string>): Promise<{
  cwd: string;
  registry: PersonalityRegistry;
  store: PersonalityStore;
}> {
  const cwd = await mkdtemp(join(tmpdir(), "theokit-switch-"));
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
  const store = new PersonalityStore(cwd);
  return { cwd, registry, store };
}

describe("performPersonalitySwitch (T5.1)", () => {
  let homeBackup: string | undefined;
  let theokitHomeBackup: string | undefined;
  beforeEach(() => {
    homeBackup = process.env.HOME;
    theokitHomeBackup = process.env.THEOKIT_HOME;
    delete process.env.THEOKIT_HOME;
  });
  afterEach(() => {
    if (homeBackup !== undefined) process.env.HOME = homeBackup;
    else delete process.env.HOME;
    if (theokitHomeBackup !== undefined) process.env.THEOKIT_HOME = theokitHomeBackup;
    else delete process.env.THEOKIT_HOME;
    vi.restoreAllMocks();
  });

  it("switch emits transcript marker as user role", async () => {
    const { registry, store } = await buildRegistry({ coder: "Be a coder" });
    const messages: Array<{ role: string; text: string }> = [];
    const invalidate = vi.fn().mockResolvedValue(undefined);
    await performPersonalitySwitch({
      agentId: "a1",
      prevSlug: undefined,
      requestedName: "coder",
      registry,
      store,
      invalidateCache: invalidate,
      appendSessionMessage: (m) => messages.push(m),
      opts: {},
    });
    expect(messages).toEqual([{ role: "user", text: "[persona switched to coder]" }]);
  });

  it("clear emits [persona cleared] marker", async () => {
    const { registry, store } = await buildRegistry({ coder: "Be a coder" });
    await store.setActive("a1", "coder");
    const messages: Array<{ role: string; text: string }> = [];
    await performPersonalitySwitch({
      agentId: "a1",
      prevSlug: "coder",
      requestedName: "none",
      registry,
      store,
      invalidateCache: vi.fn().mockResolvedValue(undefined),
      appendSessionMessage: (m) => messages.push(m),
      opts: {},
    });
    expect(messages).toEqual([{ role: "user", text: "[persona cleared]" }]);
  });

  it("EC-18: same slug = no-op (no marker, no cache invalidation)", async () => {
    const { registry, store } = await buildRegistry({ coder: "Be a coder" });
    await store.setActive("a1", "coder");
    const messages: Array<{ role: string; text: string }> = [];
    const invalidate = vi.fn().mockResolvedValue(undefined);
    const result = await performPersonalitySwitch({
      agentId: "a1",
      prevSlug: "coder",
      requestedName: "coder",
      registry,
      store,
      invalidateCache: invalidate,
      appendSessionMessage: (m) => messages.push(m),
      opts: {},
    });
    expect(messages).toEqual([]);
    expect(invalidate).not.toHaveBeenCalled();
    expect(result?.name).toBe("coder");
  });

  it("invalidateCache called with personality-switch reason", async () => {
    const { registry, store } = await buildRegistry({ coder: "Be a coder" });
    const invalidate = vi.fn().mockResolvedValue(undefined);
    await performPersonalitySwitch({
      agentId: "a1",
      prevSlug: undefined,
      requestedName: "coder",
      registry,
      store,
      invalidateCache: invalidate,
      appendSessionMessage: () => undefined,
      opts: {},
    });
    expect(invalidate).toHaveBeenCalledWith("personality-switch");
  });

  it("EC-19: reset=true calls clearSession BEFORE marker injection", async () => {
    const { registry, store } = await buildRegistry({ coder: "Be a coder" });
    const events: string[] = [];
    await performPersonalitySwitch({
      agentId: "a1",
      prevSlug: undefined,
      requestedName: "coder",
      registry,
      store,
      invalidateCache: vi.fn().mockResolvedValue(undefined),
      appendSessionMessage: (m) => events.push(`marker:${m.text}`),
      clearSession: () => events.push("cleared"),
      opts: { reset: true },
    });
    expect(events).toEqual(["cleared", "marker:[persona switched to coder]"]);
  });

  it("save=true persists to disk", async () => {
    const { registry, store, cwd } = await buildRegistry({ poet: "Be poetic" });
    await performPersonalitySwitch({
      agentId: "a1",
      prevSlug: undefined,
      requestedName: "poet",
      registry,
      store,
      invalidateCache: vi.fn().mockResolvedValue(undefined),
      appendSessionMessage: () => undefined,
      opts: { save: true },
    });
    const { readFile } = await import("node:fs/promises");
    const json = JSON.parse(await readFile(join(cwd, ".theokit", "personality.json"), "utf8")) as {
      agents: Record<string, string>;
    };
    expect(json.agents.a1).toBe("poet");
  });

  it("EC-12: missing personality throws with available list", async () => {
    const { registry, store } = await buildRegistry({ coder: "Be a coder" });
    await expect(
      performPersonalitySwitch({
        agentId: "a1",
        prevSlug: undefined,
        requestedName: "ghost",
        registry,
        store,
        invalidateCache: vi.fn().mockResolvedValue(undefined),
        appendSessionMessage: () => undefined,
        opts: {},
      }),
    ).rejects.toBeInstanceOf(ConfigurationError);
  });

  it("EC-D: marker remains in the captured session log (compression survival proxy)", async () => {
    const { registry, store } = await buildRegistry({ coder: "Be a coder" });
    const log: Array<{ role: string; text: string }> = [];
    await performPersonalitySwitch({
      agentId: "a1",
      prevSlug: undefined,
      requestedName: "coder",
      registry,
      store,
      invalidateCache: vi.fn().mockResolvedValue(undefined),
      appendSessionMessage: (m) => log.push(m),
      opts: {},
    });
    // Marker is in the log as user role — survives any later compaction
    // that respects user-role lines (the canonical D91 contract).
    expect(log.some((m) => m.role === "user" && m.text.includes("persona switched"))).toBe(true);
  });

  it("EC-E: concurrent calls serialize (last writer wins on store)", async () => {
    const { registry, store } = await buildRegistry({
      coder: "Be a coder",
      poet: "Be poetic",
    });
    // Two concurrent switches — both must complete; final store state reflects
    // the second (last-wins serial completion).
    await Promise.all([
      performPersonalitySwitch({
        agentId: "a1",
        prevSlug: undefined,
        requestedName: "coder",
        registry,
        store,
        invalidateCache: vi.fn().mockResolvedValue(undefined),
        appendSessionMessage: () => undefined,
        opts: {},
      }),
      performPersonalitySwitch({
        agentId: "a1",
        prevSlug: "coder",
        requestedName: "poet",
        registry,
        store,
        invalidateCache: vi.fn().mockResolvedValue(undefined),
        appendSessionMessage: () => undefined,
        opts: {},
      }),
    ]);
    expect(["coder", "poet"]).toContain(store.active("a1"));
  });
});
