import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  appendFactToMarkdown,
  memoryDir,
  memoryMdPath,
  readFactsFromMarkdown,
} from "../../../src/internal/memory/storage/markdown-store.js";

/*
 * #389 — a memory fact carried no kind and no timestamp, so nothing could tell a durable
 * preference from a project note that went stale.
 *
 * `MemoryFact` was `{ text }` and a fact on disk was a bullet under `## Facts`. The three example
 * facts in the report — a preference, a project fact, a reference — age differently and were
 * indistinguishable: no staleness signal, no recall filter, no basis for selective retention, and
 * no way for a surface to show "what I remember about you" apart from "what I know about this
 * project".
 *
 * The four kinds are additive and never inferred: a wrong kind is worse than none, because it makes
 * retention and recall confident about the wrong thing.
 */

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "mem-kind-"));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

const seed = (body: string): void => {
  mkdirSync(memoryDir(cwd), { recursive: true });
  writeFileSync(memoryMdPath(cwd), body);
};

it("round-trips a fact's kind", async () => {
  await appendFactToMarkdown(cwd, { text: "the user prefers pnpm over npm", kind: "user" });

  const [fact] = await readFactsFromMarkdown(cwd);
  expect(fact?.text).toBe("the user prefers pnpm over npm");
  expect(fact?.kind).toBe("user");
});

it("stamps modified itself, and ignores a caller that tries to supply one", async () => {
  // A timestamp a caller can set is a timestamp that can lie about when something was learned.
  await appendFactToMarkdown(cwd, {
    text: "the payment webhook retries three times",
    kind: "project",
    modified: "1999-01-01T00:00:00.000Z",
  });

  const [fact] = await readFactsFromMarkdown(cwd);
  expect(fact?.modified).not.toBe("1999-01-01T00:00:00.000Z");
  expect(fact?.modified).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

it("keeps a hand-written bullet readable, with no kind invented for it", async () => {
  // The accepted case (`testing.md` § 4.2), and the constraint the report is most explicit about:
  // `## Facts` bullets are already on disk in consumers' repositories, and the store's own header
  // tells the user to edit freely. A hand-written bullet must not start failing to parse, and must
  // not acquire a kind nobody chose.
  seed("# Memory\n\n## Facts\n\n- see the dashboard at https://grafana.internal/agents\n");

  const [fact] = await readFactsFromMarkdown(cwd);
  expect(fact?.text).toBe("see the dashboard at https://grafana.internal/agents");
  expect(fact?.kind).toBeUndefined();
  expect(fact?.modified).toBeUndefined();
});

it("leaves the metadata out of the text a consumer reads", async () => {
  await appendFactToMarkdown(cwd, { text: "billing runs on the 1st", kind: "project" });

  const [fact] = await readFactsFromMarkdown(cwd);
  expect(fact?.text).toBe("billing runs on the 1st");
  expect(fact?.text).not.toContain("kind");
  expect(fact?.text).not.toContain("<!--");
});

it("does not mistake a fact that merely mentions the marker for a typed one", async () => {
  // The REAL marker, mid-sentence. A weaker test would use a lookalike, which passes whether or
  // not the pattern is anchored — and the anchor is the whole guarantee here.
  seed(
    "# Memory\n\n## Facts\n\n" +
      "- <!-- theokit:fact kind=user --> is how a typed fact is marked, per the docs\n",
  );

  const [fact] = await readFactsFromMarkdown(cwd);
  // Only a marker at the END of the bullet is metadata; anything else is the user's own text and
  // must survive verbatim.
  expect(fact?.text).toBe(
    "<!-- theokit:fact kind=user --> is how a typed fact is marked, per the docs",
  );
  expect(fact?.kind).toBeUndefined();
});

it("keeps an untyped fact untyped on disk", async () => {
  await appendFactToMarkdown(cwd, { text: "no kind given" });

  const raw = readFileSync(memoryMdPath(cwd), "utf8");
  expect(raw).toContain("- no kind given");
  expect(raw).not.toContain("kind=");

  const [fact] = await readFactsFromMarkdown(cwd);
  expect(fact?.kind).toBeUndefined();
});

it("refuses a kind outside the four", async () => {
  // Fail-fast at the boundary rather than writing a value recall will later trust
  // (`error-handling.md` § 2).
  await expect(appendFactToMarkdown(cwd, { text: "x", kind: "guess" as never })).rejects.toThrow(
    /kind/i,
  );
});
