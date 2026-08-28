import { expect, it } from "vitest";
import {
  parseMemoryFile,
  renderMemoryFile,
  slugForFact,
  titleForFact,
} from "../../../src/internal/memory/storage/memory-file.js";

/*
 * The on-disk shape of ONE memory, converged with Claude Code's.
 *
 * `@theokit/sdk` already writes native Claude Code `.jsonl` sessions — the README's own
 * differentiator is "point `local.sessionDir` at `~/.claude` and the Claude Code CLI can
 * `--continue` a session your agent wrote". Memory had no such convergence: #389 encoded a fact's
 * kind in an HTML comment on a `## Facts` bullet, which the Claude Code CLI reads as prose.
 *
 * Measured from a real store (9 files): the minimum contract is `name`, `description` and
 * `metadata.type`; `node_type`, `originSessionId` and `modified` are stamped by the runtime, and
 * three of the nine lack them while still being read.
 */

const FRONTMATTER = `---
name: prefers-pnpm
description: "the user prefers pnpm over npm"
metadata:
  node_type: memory
  type: user
  modified: 2026-08-25T12:00:00.000Z
---

the user prefers pnpm over npm
`;

it("renders the shape Claude Code reads", () => {
  const out = renderMemoryFile({
    name: "prefers-pnpm",
    description: "the user prefers pnpm over npm",
    kind: "user",
    modified: "2026-08-25T12:00:00.000Z",
    body: "the user prefers pnpm over npm",
  });

  expect(out).toBe(FRONTMATTER);
});

it("round-trips what it rendered", () => {
  const parsed = parseMemoryFile(FRONTMATTER);

  expect(parsed).toEqual({
    name: "prefers-pnpm",
    description: "the user prefers pnpm over npm",
    kind: "user",
    modified: "2026-08-25T12:00:00.000Z",
    body: "the user prefers pnpm over npm",
  });
});

it("reads a file that carries only the minimum contract", () => {
  // Three of the nine measured files have no `node_type`, no `originSessionId` and no `modified`.
  // Refusing those would refuse memories Claude Code itself accepts.
  const parsed = parseMemoryFile(
    ["---", "name: x", "description: y", "metadata:", "  type: project", "---", "", "body"].join(
      "\n",
    ),
  );

  expect(parsed?.kind).toBe("project");
  expect(parsed?.modified).toBeUndefined();
  expect(parsed?.body).toBe("body");
});

it("refuses a kind outside the four rather than trusting the file", () => {
  // The file is hand-editable. An unknown `type` reads as untyped, never as a fifth kind — recall
  // must not act on a value the contract does not admit.
  const parsed = parseMemoryFile(
    ["---", "name: x", "description: y", "metadata:", "  type: guess", "---", "", "b"].join("\n"),
  );

  expect(parsed?.kind).toBeUndefined();
});

it("returns undefined for a file that is not a memory at all", () => {
  // The accepted case (`testing.md` § 4.2): a reader that produced a memory for any input would
  // turn every stray markdown file in the directory into a fact.
  expect(parseMemoryFile("# Just a heading\n\nsome prose\n")).toBeUndefined();
  expect(parseMemoryFile("---\nname: x\n---\n\nno description\n")).toBeUndefined();
});

it("names the memory after its subject, not after its whole text", () => {
  // The interop partner names files after the topic — measured at 30.6 characters over 688 real
  // files. Function words carry no topic signal and are dropped.
  expect(slugForFact("the user prefers pnpm over npm")).toBe("user-prefers-pnpm-npm");
  expect(slugForFact("Billing runs on the 1st!")).toBe("billing-runs-1st");
});

it("keeps a payload out of the filename by naming the subject (#446)", () => {
  // Not a rule about secrets — a rule about names. A secret rule would have to RECOGNISE the
  // secret, and pattern matching cannot recognise `sirius-sod521`. Naming the memory after what
  // it is about excludes the tail of the sentence whatever the tail happens to be.
  const slug = slugForFact("The deploy passphrase for the atlas cluster is sirius-sod521");

  expect(slug).toBe("deploy-passphrase-atlas-cluster");
  expect(slug).not.toContain("sirius");
  expect(slug).not.toContain("sod521");
});

it("derives a title in the shape the index is read in", () => {
  // Measured over 673 real index lines: median 4 words, 29 characters, p90 at 39.
  expect(titleForFact("The deploy passphrase for the atlas cluster is sirius-sod521")).toBe(
    "Deploy passphrase atlas cluster",
  );
  expect(titleForFact("the user prefers pnpm over npm")).toBe("User prefers pnpm npm");
});

it("falls back to a hashed slug when the text has no usable characters", () => {
  // Never throws and never returns "": the filename is derived from attacker-shaped text, so the
  // safe grammar is the floor, not the readable form.
  const slug = slugForFact("→ ✳ ✦");

  expect(slug).not.toBe("");
  expect(slug).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
});
