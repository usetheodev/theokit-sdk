/**
 * usetheokit/theokit-sdk#531 — `THEO.md` was the only context file that could not live at the
 * project root, and the miss was silent.
 *
 * Every sibling — `AGENTS.md`, `GEMINI.md`, `CLAUDE.md` — is `scope: "git-root-walk"`: found at
 * the root, and from any subdirectory. `THEO.md` was `scope: "cwd-only"` pointed at
 * `.theokit/THEO.md` specifically — a root `THEO.md` was never read, with no warning that it had
 * been ignored.
 *
 * The fix ADDS a spec rather than moving the existing one — `.theokit/THEO.md` keeps working
 * unchanged for every project already using it, and the new root spec's `priority` (55) sits
 * BELOW the existing one (60) so `.theokit/THEO.md` is the later, winning source on conflict —
 * the precedence the issue asks for. Sits between `theokit-context` (50) and `THEO.md` (60),
 * leaving room on both sides per the numbering discipline `claude-rules`'s own comment records.
 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, onTestFinished } from "vitest";

import { DEFAULT_DISCOVERY_SPECS } from "../../../src/internal/runtime/context/context-discovery.js";
import { runDiscovery } from "../../../src/internal/runtime/context/context-discovery-runner.js";
import { removeTempDirRobust } from "../../helpers/temp-workspace.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await removeTempDirRobust(d);
});

async function workspace(): Promise<string> {
  const tmp = await mkdtemp(join(tmpdir(), "theo-md-root-"));
  dirs.push(tmp);
  onTestFinished(async () => {});
  await mkdir(join(tmp, ".git"), { recursive: true });
  return tmp;
}

describe("THEO.md at the project root", () => {
  it("is read, the way AGENTS.md/GEMINI.md/CLAUDE.md already are", async () => {
    const tmp = await workspace();
    await writeFile(
      join(tmp, "THEO.md"),
      'The internal name for the billing service is "Kestrel".',
    );

    const sources = await runDiscovery({ cwd: tmp, maxBytesPerFile: 100_000 });

    const root = sources.find((s) => s.content.includes("Kestrel"));
    expect(root).toBeDefined();
  });

  it("is reachable by walking up from a subdirectory, like its siblings", async () => {
    const tmp = await workspace();
    await writeFile(
      join(tmp, "THEO.md"),
      'The internal name for the billing service is "Kestrel".',
    );
    const deep = join(tmp, "packages/api/src");
    await mkdir(deep, { recursive: true });

    const sources = await runDiscovery({ cwd: deep, maxBytesPerFile: 100_000 });

    expect(sources.some((s) => s.content.includes("Kestrel"))).toBe(true);
  });

  it("still reads .theokit/THEO.md unchanged when no root THEO.md exists", async () => {
    const tmp = await workspace();
    await mkdir(join(tmp, ".theokit"), { recursive: true });
    await writeFile(join(tmp, ".theokit", "THEO.md"), "legacy location, still works");

    const sources = await runDiscovery({ cwd: tmp, maxBytesPerFile: 100_000 });

    expect(sources.some((s) => s.content.includes("legacy location"))).toBe(true);
  });

  it(".theokit/THEO.md wins the merge order when both exist — the requested precedence", async () => {
    const tmp = await workspace();
    await writeFile(join(tmp, "THEO.md"), "root says X");
    await mkdir(join(tmp, ".theokit"), { recursive: true });
    await writeFile(join(tmp, ".theokit", "THEO.md"), "dot-theokit says Y");

    const sources = await runDiscovery({ cwd: tmp, maxBytesPerFile: 100_000 });

    const root = sources.find((s) => s.content === "root says X");
    const dotTheokit = sources.find((s) => s.content === "dot-theokit says Y");
    expect(root).toBeDefined();
    expect(dotTheokit).toBeDefined();
    // "later content wins on conflict" (DiscoverySpec docblock) — priority orders the merged
    // prompt ascending, so the winning source has the HIGHER priority number.
    expect(dotTheokit?.priority).toBeGreaterThan(root?.priority ?? Number.POSITIVE_INFINITY);
  });

  it("registers the new root spec with room on both sides, per this file's numbering discipline", () => {
    const priorities = DEFAULT_DISCOVERY_SPECS.map((s) => s.priority).sort((a, b) => a - b);
    expect(new Set(priorities).size).toBe(priorities.length); // no duplicate priority

    const root = DEFAULT_DISCOVERY_SPECS.find((s) => s.pattern === "THEO.md");
    const dotTheokit = DEFAULT_DISCOVERY_SPECS.find((s) => s.pattern === ".theokit/THEO.md");
    expect(root).toBeDefined();
    expect(dotTheokit).toBeDefined();
    expect(root?.scope).toBe("git-root-walk");
    expect(dotTheokit?.scope).toBe("cwd-only"); // unchanged — no behaviour change for existing files
    expect(dotTheokit?.priority).toBeGreaterThan(root?.priority ?? 0);
  });
});
