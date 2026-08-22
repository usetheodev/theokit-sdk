/**
 * Tests for PersonalityRegistry (T1.1, ADRs D161 / D162).
 */

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { ConfigurationError } from "../../../src/errors.js";
import { PersonalityRegistry } from "../../../src/internal/personality/registry.js";
import { removeTempDirRobust } from "../../helpers/temp-workspace.js";

const PROJECT_REL = ".theokit/personalities";
const USER_REL = ".theokit/personalities";

async function buildProjectDir(): Promise<{ tmp: string; projectDir: string }> {
  const tmp = await mkdtemp(join(tmpdir(), "theokit-personality-"));
  const __tmpCleanup1 = tmp;
  onTestFinished(async () => {
    await removeTempDirRobust(__tmpCleanup1);
  });
  const projectDir = join(tmp, PROJECT_REL);
  await mkdir(projectDir, { recursive: true });
  return { tmp, projectDir };
}

async function buildUserDir(): Promise<{ userHome: string; userDir: string }> {
  const userHome = await mkdtemp(join(tmpdir(), "theokit-home-"));
  const __userHomeCleanup2 = userHome;
  onTestFinished(async () => {
    await removeTempDirRobust(__userHomeCleanup2);
  });
  const userDir = join(userHome, USER_REL);
  await mkdir(userDir, { recursive: true });
  return { userHome, userDir };
}

describe("PersonalityRegistry (T1.1)", () => {
  let originalHome: string | undefined;
  beforeEach(() => {
    originalHome = process.env.HOME;
  });
  afterEach(() => {
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
    vi.restoreAllMocks();
  });

  it("loads project personalities", async () => {
    const { tmp, projectDir } = await buildProjectDir();
    await writeFile(join(projectDir, "coder.md"), "---\nname: coder\n---\nBe a coder");
    process.env.HOME = "/var/empty";
    const reg = await PersonalityRegistry.load(tmp);
    expect(reg.all().length).toBe(1);
    expect(reg.get("coder")?.systemPrompt).toBe("Be a coder");
    expect(reg.get("coder")?.source).toBe("project");
  });

  it("loads user personalities", async () => {
    const { tmp } = await buildProjectDir();
    const { userHome, userDir } = await buildUserDir();
    await writeFile(join(userDir, "poet.md"), "---\nname: poet\n---\nWrite poetry");
    process.env.HOME = userHome;
    const reg = await PersonalityRegistry.load(tmp);
    expect(reg.get("poet")?.source).toBe("user");
  });

  it("project wins on slug collision (EC-1)", async () => {
    const { tmp, projectDir } = await buildProjectDir();
    const { userHome, userDir } = await buildUserDir();
    await writeFile(join(projectDir, "coder.md"), "---\nname: coder\n---\nproject body");
    await writeFile(join(userDir, "coder.md"), "---\nname: coder\n---\nuser body");
    process.env.HOME = userHome;
    const reg = await PersonalityRegistry.load(tmp);
    expect(reg.get("coder")?.systemPrompt).toBe("project body");
    expect(reg.get("coder")?.source).toBe("project");
  });

  it("warning emitted once per collision", async () => {
    const stderr = vi.spyOn(process.stderr, "write");
    const { tmp, projectDir } = await buildProjectDir();
    const { userHome, userDir } = await buildUserDir();
    // Unique slug to avoid warnOnce global dedup interfering with the test.
    await writeFile(join(projectDir, "scribe.md"), "---\nname: scribe\n---\nproject");
    await writeFile(join(userDir, "scribe.md"), "---\nname: scribe\n---\nuser");
    process.env.HOME = userHome;
    await PersonalityRegistry.load(tmp);
    const calls = stderr.mock.calls
      .flat()
      .filter(
        (s) =>
          typeof s === "string" && s.includes('personality "scribe" overridden by project preset'),
      );
    expect(calls.length).toBeGreaterThanOrEqual(1);
    stderr.mockRestore();
  });

  it("malformed frontmatter throws ConfigurationError (EC-2)", async () => {
    const { tmp, projectDir } = await buildProjectDir();
    // Missing required `name` field
    await writeFile(join(projectDir, "broken.md"), "---\ndescription: foo\n---\nbody");
    process.env.HOME = "/var/empty";
    await expect(PersonalityRegistry.load(tmp)).rejects.toThrow(ConfigurationError);
  });

  it("empty directory returns empty array (EC-3)", async () => {
    const { tmp } = await buildProjectDir();
    process.env.HOME = "/var/empty";
    const reg = await PersonalityRegistry.load(tmp);
    expect(reg.all()).toEqual([]);
  });

  it("get returns undefined for unknown name", async () => {
    const { tmp } = await buildProjectDir();
    process.env.HOME = "/var/empty";
    const reg = await PersonalityRegistry.load(tmp);
    expect(reg.get("nonexistent")).toBeUndefined();
  });

  it("reserved names rejected at registry load (none/default/neutral)", async () => {
    const { tmp, projectDir } = await buildProjectDir();
    await writeFile(join(projectDir, "x.md"), "---\nname: none\n---\nbody");
    process.env.HOME = "/var/empty";
    await expect(PersonalityRegistry.load(tmp)).rejects.toThrow(/reserved/);
  });

  it("isReservedClearSlug recognizes none/default/neutral", () => {
    expect(PersonalityRegistry.isReservedClearSlug("none")).toBe(true);
    expect(PersonalityRegistry.isReservedClearSlug("default")).toBe(true);
    expect(PersonalityRegistry.isReservedClearSlug("neutral")).toBe(true);
    expect(PersonalityRegistry.isReservedClearSlug("coder")).toBe(false);
  });

  it("empty body rejected with personality_empty_body code", async () => {
    const { tmp, projectDir } = await buildProjectDir();
    await writeFile(join(projectDir, "empty.md"), "---\nname: empty\n---\n");
    process.env.HOME = "/var/empty";
    await expect(PersonalityRegistry.load(tmp)).rejects.toMatchObject({
      code: "personality_empty_body",
    });
  });

  // EC-C: lowercase-only
  it("EC-C: uppercase name rejected by Zod regex", async () => {
    const { tmp, projectDir } = await buildProjectDir();
    await writeFile(join(projectDir, "x.md"), "---\nname: Coder\n---\nbody");
    process.env.HOME = "/var/empty";
    await expect(PersonalityRegistry.load(tmp)).rejects.toThrow(/lowercase/);
  });
});
