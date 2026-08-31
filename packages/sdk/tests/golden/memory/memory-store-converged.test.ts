import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  appendFactToMarkdown,
  memoryMdPath,
  readFactsFromMarkdown,
} from "../../../src/internal/memory/storage/markdown-store.js";
import { resolveMemoryRoot } from "../../../src/internal/memory/storage/memory-root.js";

/*
 * The store's on-disk layout, converged with Claude Code's.
 *
 * The SDK's differentiator is that it writes the formats that CLI reads — `local.sessionDir` at
 * `~/.claude` and `--continue` works. Memory did not hold that line: a fact was a bullet under
 * `## Facts` with its kind in an HTML comment (#389), and `MEMORY.md` was the facts themselves
 * rather than an index. Pointing a memory directory at `~/.claude/projects/<project>/memory/`
 * produced nothing the CLI could open.
 *
 * Now: one file per memory with the frontmatter Claude Code writes, and `MEMORY.md` as the index
 * that points at them. Legacy `## Facts` bullets are still READ, because they are already on disk
 * in consumers' repositories and a format change must not delete what someone recorded.
 */

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "mem-converged-"));
});
afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

const files = (): string[] => readdirSync(resolveMemoryRoot(cwd)).sort();

it("writes one file per memory, in the shape the Claude Code CLI reads", async () => {
  await appendFactToMarkdown(cwd, { text: "the user prefers pnpm over npm", kind: "user" });

  expect(files()).toContain("user-prefers-pnpm-npm.md");
  const raw = readFileSync(join(resolveMemoryRoot(cwd), "user-prefers-pnpm-npm.md"), "utf8");
  expect(raw).toMatch(/^---\n/);
  expect(raw).toContain("name: user-prefers-pnpm-npm");
  expect(raw).toContain("metadata:");
  expect(raw).toContain("  type: user");
  expect(raw).toMatch(/ {2}modified: \d{4}-\d{2}-\d{2}T/);
});

it("keeps MEMORY.md as an index that points at the files", async () => {
  await appendFactToMarkdown(cwd, { text: "billing runs on the 1st", kind: "project" });

  const index = readFileSync(memoryMdPath(resolveMemoryRoot(cwd)), "utf8");
  // `- [Title](slug.md) — hook`, the interop partner's index shape.
  expect(index).toContain("[Billing runs 1st](billing-runs-1st.md) — billing runs on the 1st");
  // The index is a pointer list, not the facts themselves — that is what makes it an index.
  expect(index).not.toContain("<!--");
});

it("round-trips a fact through the converged layout", async () => {
  await appendFactToMarkdown(cwd, {
    text: "the payment webhook retries three times",
    kind: "project",
  });

  const [fact] = await readFactsFromMarkdown(cwd);
  expect(fact?.text).toBe("the payment webhook retries three times");
  expect(fact?.kind).toBe("project");
  expect(fact?.modified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

it("still reads legacy `## Facts` bullets, so no consumer loses what it recorded", async () => {
  // The accepted case that matters most (`testing.md` § 4.2). These files are already in
  // consumers' repositories; a converged writer that stopped reading them would delete history on
  // upgrade, which is worse than the format it fixes.
  mkdirSync(resolveMemoryRoot(cwd), { recursive: true });
  writeFileSync(
    memoryMdPath(resolveMemoryRoot(cwd)),
    "# Memory\n\n## Facts\n\n- see the dashboard at https://grafana.internal\n",
  );

  const facts = await readFactsFromMarkdown(cwd);

  expect(facts.map((f) => f.text)).toContain("see the dashboard at https://grafana.internal");
});

it("reads legacy bullets and new files together", async () => {
  mkdirSync(resolveMemoryRoot(cwd), { recursive: true });
  writeFileSync(memoryMdPath(resolveMemoryRoot(cwd)), "# Memory\n\n## Facts\n\n- an old bullet\n");

  await appendFactToMarkdown(cwd, { text: "a new memory", kind: "user" });
  const texts = (await readFactsFromMarkdown(cwd)).map((f) => f.text).sort();

  expect(texts).toEqual(["a new memory", "an old bullet"]);
});

it("writes an untyped fact without inventing a kind for it", async () => {
  await appendFactToMarkdown(cwd, { text: "no kind given" });

  const raw = readFileSync(join(resolveMemoryRoot(cwd), "kind-given.md"), "utf8");
  // `node_type: memory` legitimately contains the substring "type:", so the assertion is on the
  // nested KIND key specifically.
  expect(raw).not.toMatch(/\n {2}type:/);
  expect((await readFactsFromMarkdown(cwd))[0]?.kind).toBeUndefined();
});

it("still refuses a kind outside the four", async () => {
  await expect(appendFactToMarkdown(cwd, { text: "x", kind: "guess" as never })).rejects.toThrow(
    /kind/i,
  );
});

it("stamps modified itself, and ignores a caller that tries to supply one", async () => {
  // Ported from the #389 suite, whose other assertions described an encoding that never reached a
  // published version. This one is about the CONTRACT, not the encoding, and survives the change:
  // a timestamp a caller can set is a timestamp that can lie about when something was learned.
  await appendFactToMarkdown(cwd, {
    text: "the payment webhook retries three times",
    kind: "project",
    modified: "1999-01-01T00:00:00.000Z",
  });

  const [fact] = await readFactsFromMarkdown(cwd);
  expect(fact?.modified).not.toBe("1999-01-01T00:00:00.000Z");
  expect(fact?.modified).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});
