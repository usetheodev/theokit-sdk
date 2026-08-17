/**
 * #301 — `local.baseDir` renamed to `local.sessionDir`.
 *
 * `baseDir` read as "the directory the agent works in", in an interface whose
 * `cwd` is the option that actually means that. Setting it to `"./"` — what the
 * name invites — ran without error and wrote transcripts into the caller's
 * repository root.
 *
 * These tests pin the rename's contract: the new name works, the old one still
 * works, the new one wins when both are given, and using the old one says so
 * through the diagnostics sink rather than failing.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Agent } from "../src/agent.js";
import { setDiagnosticsSink } from "../src/internal/diagnostics.js";

describe("local.sessionDir (#301)", () => {
  let workspace: string;
  let messages: string[];

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "theokit-session-dir-"));
    messages = [];
    setDiagnosticsSink((m) => messages.push(m));
  });

  afterEach(() => {
    setDiagnosticsSink(undefined);
    rmSync(workspace, { recursive: true, force: true });
  });

  /** The transcript root the agent resolved, however it was configured. */
  async function resolvedDir(local: Record<string, unknown>): Promise<string> {
    const agent = await Agent.create({
      apiKey: "test-key",
      model: { id: "openai/gpt-4o-mini" },
      local: { cwd: workspace, ...local },
    });
    // `transcriptBaseDir` is private; the session store is built from it.
    const dir = (agent as unknown as { transcriptBaseDir: string }).transcriptBaseDir;
    await agent.dispose();
    return dir;
  }

  it("uses sessionDir when given", async () => {
    const dir = join(workspace, "transcripts");
    expect(await resolvedDir({ sessionDir: dir })).toBe(dir);
  });

  it("still honours the deprecated baseDir, so a rename breaks nobody", async () => {
    const dir = join(workspace, "legacy");
    expect(await resolvedDir({ baseDir: dir })).toBe(dir);
  });

  it("warns through the diagnostics sink when the deprecated name is used", async () => {
    await resolvedDir({ baseDir: join(workspace, "legacy") });
    const warning = messages.find((m) => m.includes("local.baseDir is deprecated"));
    expect(warning).toBeDefined();
    // The warning has to say which directory it is, because the confusion with
    // `cwd` is the whole reason for the rename.
    expect(warning).toContain("local.cwd");
  });

  it("prefers sessionDir when both are set, and says so", async () => {
    const wanted = join(workspace, "new");
    expect(await resolvedDir({ sessionDir: wanted, baseDir: join(workspace, "old") })).toBe(wanted);
    expect(messages.some((m) => m.includes("using sessionDir"))).toBe(true);
  });

  it("falls back to the default when neither is set", async () => {
    const dir = await resolvedDir({});
    expect(dir).not.toBe(workspace);
    expect(dir.length).toBeGreaterThan(0);
  });
});
