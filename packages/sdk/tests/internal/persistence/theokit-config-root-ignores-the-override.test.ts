import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { theokitConfigRoot } from "../../../src/internal/persistence/paths.js";

/**
 * `theokitConfigRoot` is the resolver five previously-independent readers now share — mcp.json,
 * the context dir + context.json, the hooks-root fallback check, registry.json, and the
 * personality PROJECT_SUBDIR. Before this, each hand-rolled `join(cwd, ".theokit", ...)`.
 *
 * The one behaviour a shared resolver must not introduce by accident is exactly the one its own
 * docblock warns about: quietly starting to follow `THEOKIT_HOME`. That is `getTheokitHome`'s job,
 * for STATE (sessions, credentials) — a project's declared CONFIGURATION is committed to git and
 * belongs to the repository regardless of where an operator points their state directory.
 *
 * This is the regression a consolidation like this one is MOST likely to introduce silently: if a
 * future edit swaps `theokitConfigRoot`'s body for `getTheokitHome`'s (they look interchangeable at
 * a glance — both take `cwd`, both return a directory), every one of the five readers picks up the
 * override at once, in a single line, with no caller-side signal that anything changed.
 */
const saved = process.env.THEOKIT_HOME;
afterEach(() => {
  if (saved === undefined) delete process.env.THEOKIT_HOME;
  else process.env.THEOKIT_HOME = saved;
});

describe("theokitConfigRoot ignores THEOKIT_HOME", () => {
  it("resolves under cwd even when the override points elsewhere", () => {
    process.env.THEOKIT_HOME = "/elsewhere/state";

    expect(theokitConfigRoot("/work")).toBe(join("/work", ".theokit"));
  });

  it("resolves under cwd with no override set", () => {
    delete process.env.THEOKIT_HOME;

    expect(theokitConfigRoot("/work")).toBe(join("/work", ".theokit"));
  });
});
