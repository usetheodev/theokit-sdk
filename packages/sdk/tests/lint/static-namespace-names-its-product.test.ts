import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { expectScopeCovered } from "./_scope-sentinel.js";

const SRC_ROOT = join(__dirname, "..", "..", "src");

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  const { readdir, stat } = await import("node:fs/promises");
  for (const name of await readdir(dir)) {
    const full = join(dir, name);
    if ((await stat(full)).isDirectory()) await walk(full, out);
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

/**
 * Twenty-five classes in `src/` have a private constructor; fourteen of them
 * have exactly one static `create()` whose body is a one-line delegation to a
 * free function. An audit read that shape as a misapplied Factory: no
 * discriminator, no variant selection, nothing a factory is for.
 *
 * The shape is not a Factory and was never meant to be one. It is a static
 * NAMESPACE under a deliberate uniformity mandate (ADR 0015 / ADR-P2) — every
 * public entry point is spelled `X.create(...)` so callers learn one verb. A
 * namespace has nothing to discriminate, so the missing discriminator is the
 * pattern label being wrong rather than the code.
 *
 * What IS a real cost: twelve of the fourteen return a type unrelated to the
 * class they hang off — `Skill.create` gives an `InlineSkill`, `SubAgent.create`
 * a `CustomTool`, `Retry.create` a `Promise<T>` because it RUNS rather than
 * builds. The name teaches the reader nothing about what comes back. Renaming
 * twelve published entry points is a major-version decision; naming the product
 * where the reader already is costs a line.
 *
 * So this gate does not defend the mandate. It defends the reader from it: a
 * namespace whose `create` returns something else must say so in its docblock.
 */
interface Namespace {
  name: string;
  returns: string;
  doc: string;
  file: string;
}

const CLASS_RE = /export (?:abstract )?class (\w+)[^{]*\{([\s\S]*?)\n\}/g;

/** The single static `create` shape, or `undefined` when this class is not one. */
function namespaceIn(source: string, match: RegExpMatchArray): Namespace | undefined {
  const [, name = "", body = ""] = match;
  if (!body.includes("private constructor")) return undefined;
  const statics = [...body.matchAll(/\n {2}static (?:async )?(\w+)/g)].map((m) => m[1]);
  if (statics.length !== 1 || statics[0] !== "create") return undefined;
  const returns = createReturnType(body);
  if (returns === name) return undefined; // returns itself — the name already says it
  const before = source.slice(0, match.index);
  return {
    name,
    returns,
    doc: before.includes("/**") ? (before.split("/**").pop() ?? "") : "",
    file: "",
  };
}

/** The declared return of `static create(...)`, generic arguments stripped. */
function createReturnType(body: string): string {
  const ret = /static (?:async )?create(?:<[^>]*>)?\([^;]*?\)\s*:\s*([^{]+)\{/s.exec(body);
  return (ret?.[1] ?? "?")
    .trim()
    .replace(/<[\s\S]*/, "")
    .trim();
}

/** Every static namespace declared in `files`. */
function namespacesIn(files: readonly string[]): Namespace[] {
  const found: Namespace[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(CLASS_RE)) {
      const ns = namespaceIn(source, match);
      if (ns !== undefined) found.push({ ...ns, file: relative(SRC_ROOT, file) });
    }
  }
  return found;
}

describe("a static namespace names the product its create() returns", () => {
  let scanned: string[] = [];
  let namespaces: Namespace[] = [];

  beforeAll(async () => {
    scanned = await walk(SRC_ROOT);
    namespaces = namespacesIn(scanned);
  });

  it("finds the namespaces — a sweep that matched none would pass silently", () => {
    // `retry.ts` holds `Retry`, the sharpest case: create() RUNS rather than builds.
    expectScopeCovered(scanned, "retry.ts", SRC_ROOT);
    expect(
      namespaces.length,
      "the class/private-constructor/single-create shape stopped matching",
    ).toBeGreaterThanOrEqual(10);
  });

  it("every one names the type its create() actually returns", () => {
    const silent = namespaces
      .filter((n) => !n.doc.includes(n.returns))
      .map((n) => `${n.file}: ${n.name} -> ${n.returns}`);
    expect(
      silent,
      "X.create() returning something other than an X is the accepted cost of the " +
        "uniformity mandate (ADR 0015). Paying it silently is not: name the product " +
        "in the class docblock so the reader does not have to open the signature",
    ).toEqual([]);
  });
});
