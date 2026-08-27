import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendFact, readFacts } from "../src/internal/memory/storage/markdown-store.js";

/**
 * SOP-06-01 quarantine, as corroboration counting.
 *
 * The condition that makes this a defence and not a counter: only the SAME text corroborates
 * itself. A rewrite starts over at one. Without that, a user correcting a fact would promote it
 * to "corroborated" with nobody having corroborated it — worse than no quarantine, because it
 * hands confidence to the entry that has not earned it.
 */
describe("memory corroboration counting", () => {
  let cwd: string;
  const cfg = { enabled: true } as never;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-corrob-"));
    await mkdir(join(cwd, ".theokit", "memory"), { recursive: true });
  });
  afterEach(async () => rm(cwd, { recursive: true, force: true }));

  const memFileFor = async (slugStart: string): Promise<string> => {
    const dir = join(cwd, ".theokit", "memory");
    const { readdir } = await import("node:fs/promises");
    const f = (await readdir(dir)).find((n) => n.startsWith(slugStart) && n.endsWith(".md"));
    return readFile(join(dir, f as string), "utf8");
  };

  it("a first write records the count as 1 — counted once, not unknown", async () => {
    // `observations: 1` and an absent field are different claims. Absent means the store never
    // counted (written before this existed, or by hand); 1 means it counted and got one. Only
    // the second earns the [unconfirmed] marker, which is what keeps the marker meaningful.
    await appendFact(cwd, cfg, { text: "The billing service runs on port 8080" });
    expect(await memFileFor("the-billing-service")).toContain("observations: 1");
  });

  it("a fact with no count is UNKNOWN, not uncorroborated", async () => {
    const dir = join(cwd, ".theokit", "memory");
    await writeFile(
      join(dir, "legacy.md"),
      `---\nname: legacy\ndescription: "x"\nmetadata:\n  node_type: memory\n---\n\nwritten before counting existed\n`,
    );
    const facts = await readFacts(cwd, cfg);
    expect(facts.find((f) => f.text.includes("before counting"))?.observations).toBeUndefined();
  });

  it("recording the SAME fact again counts as a second observation", async () => {
    await appendFact(cwd, cfg, { text: "The billing service runs on port 8080" });
    await appendFact(cwd, cfg, { text: "The billing service runs on port 8080" });
    expect(await memFileFor("the-billing-service")).toContain("observations: 2");
  });

  it("treats trivial punctuation and case differences as the same observation", async () => {
    await appendFact(cwd, cfg, { text: "Deploys need review" });
    await appendFact(cwd, cfg, { text: "deploys need review." });
    expect(await memFileFor("deploys-need-review")).toContain("observations: 2");
  });

  it("a REWRITE under the same slug starts over at one", async () => {
    // The failure mode this guards: `slugForFact` truncates at 64 chars, so two different facts
    // sharing a long prefix land on one filename. Counting by filename would corroborate a fact
    // that was never observed twice.
    const prefix = "The deployment runbook for the atlas production cluster says that ";
    await appendFact(cwd, cfg, { text: `${prefix}reviews are required` });
    await appendFact(cwd, cfg, { text: `${prefix}reviews are optional` });
    const body = await memFileFor("the-deployment-runbook");
    expect(body).toContain("observations: 1");
    expect(body).not.toContain("observations: 2");
    expect(body).toContain("reviews are optional");
  });

  it("a third identical observation keeps counting", async () => {
    for (let i = 0; i < 3; i++) await appendFact(cwd, cfg, { text: "Use pnpm, not npm" });
    expect(await memFileFor("use-pnpm")).toContain("observations: 3");
  });

  it("round-trips the count through read", async () => {
    await appendFact(cwd, cfg, { text: "Use pnpm, not npm" });
    await appendFact(cwd, cfg, { text: "Use pnpm, not npm" });
    const facts = await readFacts(cwd, cfg);
    const f = facts.find((x) => x.text.includes("pnpm"));
    expect(f?.observations).toBe(2);
  });

  it("ignores a hand-edited count that is not a positive integer", async () => {
    const dir = join(cwd, ".theokit", "memory");
    await writeFile(
      join(dir, "planted.md"),
      `---\nname: planted\ndescription: "x"\nmetadata:\n  node_type: memory\n  observations: 9999.5\n---\n\nplanted claim\n`,
    );
    const facts = await readFacts(cwd, cfg);
    expect(facts.find((f) => f.text === "planted claim")?.observations).toBeUndefined();
  });
});
