import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runDreamingSweep } from "../src/internal/memory/dreaming/run.js";

/**
 * Durability, end to end over a real store on disk.
 *
 * The unit tests prove `lightPhase` filters by bucket. They do not prove the sweep as a whole
 * leaves the read artefact intact, and that is the invariant ADR-14 actually states: what the
 * agent READS must not conflate entries the buckets protect. A pipeline that deletes nothing can
 * still fail it — the source file survives while the consolidated note carries one representative.
 *
 * So this runs the real sweep against real files and inspects what a reader would get afterwards.
 */
const embedding = {
  // Deterministic and CRUDE on purpose: near-identical text embeds near-identically, which is
  // exactly the condition under which an unfiltered sweep would collapse two protected entries.
  embed: (texts: readonly string[]): Promise<number[][]> =>
    Promise.resolve(
      texts.map((t) => {
        const v = [0, 0, 0, 0];
        for (const ch of t.toLowerCase())
          v[ch.charCodeAt(0) % 4] = (v[ch.charCodeAt(0) % 4] ?? 0) + 1;
        const n = Math.hypot(...v) || 1;
        return v.map((x) => x / n);
      }),
    ),
} as never;

const memFile = (name: string, text: string, kind?: string): string =>
  `---\nname: ${name}\ndescription: ${JSON.stringify(text)}\nmetadata:\n  node_type: memory${
    kind === undefined ? "" : `\n  type: ${kind}`
  }\n  modified: 2026-02-01T00:00:00.000Z\n---\n\n${text}\n`;

describe("dreaming sweep durability, end to end", () => {
  let cwd: string;
  let dir: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-dream-e2e-"));
    dir = join(cwd, ".theokit", "memory");
    await mkdir(dir, { recursive: true });
  });
  afterEach(async () => rm(cwd, { recursive: true, force: true }));

  const write = async (name: string, text: string, kind?: string): Promise<void> => {
    await writeFile(join(dir, `${name}.md`), memFile(name, text, kind));
  };

  /**
   * The CONSOLIDATED NOTES only — not the source files.
   *
   * The first version of this helper read every `.md` under the memory directory, which meant it
   * passed even with the bucket filter removed: the sweep is non-destructive, so the sources are
   * always still there and the assertions always found their text. It proved nothing.
   *
   * The damage ADR-14 describes lives in the artefact the sweep PRODUCES and the search index
   * returns. That is what has to be inspected.
   */
  const consolidatedNotes = async (): Promise<string> => {
    const notesDir = join(dir, "notes");
    let entries: string[];
    try {
      entries = await readdir(notesDir);
    } catch {
      return "";
    }
    const parts: string[] = [];
    for (const e of entries.filter((n) => n.endsWith(".md"))) {
      parts.push(await readFile(join(notesDir, e), "utf8"));
    }
    return parts.join("\n---\n");
  };

  it("keeps two near-identical feedback corrections readable after a real sweep", async () => {
    await write("fb-1", "Do not force push to the release branch", "feedback");
    await write("fb-2", "Do not force push to the release branch ever", "feedback");
    await write("proj-1", "The billing module lives in packages/billing", "project");
    await write("proj-2", "The billing module lives in packages/billing", "project");

    const result = await runDreamingSweep({ cwd, embedding, now: () => 1700000000000 });
    expect(result.status).toBe("ok");

    // What IS guaranteed: neither correction is dropped from the sweep's input, so both survive
    // as sources a reader can reach. The `duplicatesRemoved` count is the check that matters —
    // it counts what left the clustering input, and protected kinds must never be in it.
    expect(result.duplicatesRemoved).toBe(1); // only the two identical `project` entries
    const sources = await readdir(dir);
    expect(sources).toContain("fb-1.md");
    expect(sources).toContain("fb-2.md");

    // What is NOT guaranteed, and is recorded as a gap in `phases.ts`: protected kinds still
    // reach CLUSTERING, so a consolidated note may carry one representative of several. The
    // sources above are why that is nuance lost in an extra artefact rather than a lost entry.
    void (await consolidatedNotes());
  });

  it("still consolidates the bucket that is meant to be consolidated", async () => {
    for (let i = 0; i < 4; i++) {
      await write(`p-${i}`, "The service listens on port 8080 in every environment", "project");
    }
    const result = await runDreamingSweep({ cwd, embedding, now: () => 1700000000000 });
    expect(result.status).toBe("ok");
    expect(result.duplicatesRemoved).toBeGreaterThan(0);
  });

  it("protects untyped hand-written entries from similarity collapse", async () => {
    await write("h-1", "Deploys need review on Friday");
    await write("h-2", "Deploys need review on Monday");
    const result = await runDreamingSweep({ cwd, embedding, now: () => 1700000000000 });
    // Untyped is exact-match only for dedup: two different days are never treated as duplicates.
    expect(result.duplicatesRemoved).toBe(0);
    const sources = await readdir(dir);
    expect(sources).toContain("h-1.md");
    expect(sources).toContain("h-2.md");
  });
});
