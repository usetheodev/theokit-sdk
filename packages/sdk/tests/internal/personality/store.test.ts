/**
 * Tests for PersonalityStore (T2.1, ADR D163 + EC-B delete-key invariant).
 */

import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { PersonalityStore } from "../../../src/internal/personality/store.js";
import { removeTempDirRobust } from "../../helpers/temp-workspace.js";

async function buildHome(): Promise<{ cwd: string; home: string; file: string }> {
  const cwd = await mkdtemp(join(tmpdir(), "theokit-personality-store-"));
  const __cwdCleanup1 = cwd;
  onTestFinished(async () => {
    await removeTempDirRobust(__cwdCleanup1);
  });
  const home = join(cwd, ".theokit");
  return { cwd, home, file: join(home, "personality.json") };
}

describe("PersonalityStore (T2.1)", () => {
  let envBackup: string | undefined;
  beforeEach(() => {
    envBackup = process.env.THEOKIT_HOME;
    delete process.env.THEOKIT_HOME;
  });
  afterEach(() => {
    if (envBackup !== undefined) process.env.THEOKIT_HOME = envBackup;
    else delete process.env.THEOKIT_HOME;
    vi.restoreAllMocks();
  });

  it("active() returns undefined initially", async () => {
    const { cwd } = await buildHome();
    const store = new PersonalityStore(cwd);
    expect(store.active("agent-x")).toBeUndefined();
  });

  it("setActive session-only does not touch disk", async () => {
    const { cwd, file } = await buildHome();
    const store = new PersonalityStore(cwd);
    await store.setActive("agent-x", "coder");
    expect(store.active("agent-x")).toBe("coder");
    await expect(readFile(file, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("setActive with save persists to disk", async () => {
    const { cwd, file } = await buildHome();
    const store = new PersonalityStore(cwd);
    await store.setActive("agent-x", "coder", { save: true });
    const json = JSON.parse(await readFile(file, "utf8")) as { agents: Record<string, string> };
    expect(json.agents["agent-x"]).toBe("coder");
  });

  it("hydrate reads persistent file", async () => {
    const { cwd, home, file } = await buildHome();
    const { mkdir } = await import("node:fs/promises");
    await mkdir(home, { recursive: true });
    await writeFile(file, JSON.stringify({ version: 1, agents: { "agent-x": "poet" } }));
    const store = new PersonalityStore(cwd);
    await store.hydrate("agent-x");
    expect(store.active("agent-x")).toBe("poet");
  });

  it("setActive undefined clears session", async () => {
    const { cwd } = await buildHome();
    const store = new PersonalityStore(cwd);
    await store.setActive("agent-x", "coder");
    const prev = await store.setActive("agent-x", undefined);
    expect(prev).toBe("coder");
    expect(store.active("agent-x")).toBeUndefined();
  });

  it("EC-B: clear with save deletes key, never writes null", async () => {
    const { cwd, file } = await buildHome();
    const store = new PersonalityStore(cwd);
    await store.setActive("agent-x", "coder", { save: true });
    await store.setActive("agent-x", undefined, { save: true });

    const raw = await readFile(file, "utf8");
    const json = JSON.parse(raw) as { agents: Record<string, string | null> };

    // EC-B: agents map MUST NOT contain a null entry for agent-x.
    expect(json.agents).not.toHaveProperty("agent-x");
    expect(raw).not.toMatch(/"agent-x"\s*:\s*null/);
  });

  it("persistent write failure does not throw (log+continue)", async () => {
    const { cwd } = await buildHome();
    const store = new PersonalityStore(cwd);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    // Force a write failure by stubbing atomic-write to throw.
    const atomicWriteMod = await import("../../../src/internal/persistence/atomic-write.js");
    const spy = vi
      .spyOn(atomicWriteMod, "atomicWriteJson")
      .mockRejectedValue(new Error("disk full"));

    // Must not throw — session state preserved.
    await expect(store.setActive("agent-x", "coder", { save: true })).resolves.toBeUndefined();
    expect(store.active("agent-x")).toBe("coder");

    spy.mockRestore();
    stderr.mockRestore();
  });

  it("unknown JSON version treated as empty", async () => {
    const { cwd, home, file } = await buildHome();
    const { mkdir } = await import("node:fs/promises");
    await mkdir(home, { recursive: true });
    await writeFile(file, JSON.stringify({ version: 999, agents: { "agent-x": "x" } }));
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const store = new PersonalityStore(cwd);
    await store.hydrate("agent-x");
    expect(store.active("agent-x")).toBeUndefined();
    stderr.mockRestore();
  });

  it("concurrent writes preserve both agents (file-lock serializes)", async () => {
    const { cwd, file } = await buildHome();
    const storeA = new PersonalityStore(cwd);
    const storeB = new PersonalityStore(cwd);
    await Promise.all([
      storeA.setActive("agent-a", "coder", { save: true }),
      storeB.setActive("agent-b", "poet", { save: true }),
    ]);
    const json = JSON.parse(await readFile(file, "utf8")) as { agents: Record<string, string> };
    expect(json.agents["agent-a"]).toBe("coder");
    expect(json.agents["agent-b"]).toBe("poet");
  });
});
