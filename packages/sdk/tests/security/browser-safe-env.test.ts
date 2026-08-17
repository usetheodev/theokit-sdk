import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readEnv } from "../../src/internal/env.js";

/**
 * The SDK must load in a browser.
 *
 * `errors.ts` is imported by the client bindings framework consumers ship to the front end, and it
 * pulls the redaction and retry modules along with it. Any bare `process.env` on that path throws
 * `ReferenceError: process is not defined` while the module graph is still evaluating — before a
 * single component renders, so the page goes blank with one console error that names no cause.
 *
 * That shipped in 4.53.0 and blanked every page of any app on `theokit@0.48.x`
 * (usetheokit/theokit#317).
 *
 * The guard is static rather than a runtime import with `globalThis.process` deleted: deleting it
 * breaks Vitest itself, which needs `process.nextTick` to finish the test. Walking the import graph
 * is also strictly stronger — it covers every module that reaches the browser, not just the two
 * that happened to be broken this time.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../../src");

/** Entry points a browser bundle can reach. `errors.ts` is the one that caused #317. */
const BROWSER_REACHABLE_ENTRIES = ["errors.ts"];

/** Strips comments so a `process.env` mentioned in prose is not read as code. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

function localImportsOf(source: string): string[] {
  return [...source.matchAll(/from\s+["'](\.[^"']+)["']/g)]
    .map((match) => match[1])
    .filter((specifier): specifier is string => specifier !== undefined)
    .map((specifier) => specifier.replace(/\.js$/, ".ts"));
}

/** Every module reachable from the given entries, following relative imports only. */
function reachableModules(entries: string[]): string[] {
  const seen = new Set<string>();
  const queue = entries.map((entry) => join(SRC, entry));

  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;

    let source: string;
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue; // a type-only or generated path we cannot resolve — not our concern here
    }
    seen.add(file);

    for (const specifier of localImportsOf(source)) {
      queue.push(resolve(dirname(file), specifier));
    }
  }

  return [...seen];
}

describe("modules reachable from a browser bundle", () => {
  const modules = reachableModules(BROWSER_REACHABLE_ENTRIES);

  it("walks a real graph, not an empty one", () => {
    // Guards the guard: a broken walker would make every assertion below vacuously pass.
    expect(modules.length).toBeGreaterThan(3);
    expect(modules.some((file) => file.endsWith("redact.ts"))).toBe(true);
  });

  it("never reads a bare `process`", () => {
    const offenders = modules.filter((file) =>
      /\bprocess\s*\./.test(stripComments(readFileSync(file, "utf8"))),
    );

    expect(
      offenders.map((file) => file.replace(`${SRC}/`, "")),
      "use readEnv() from internal/env.ts — a bare `process` is a ReferenceError in a browser",
    ).toEqual([]);
  });

  it("never touches another Node-only global at module scope", () => {
    const nodeOnly = /\b(__dirname|__filename)\b/;
    const offenders = modules.filter((file) =>
      nodeOnly.test(stripComments(readFileSync(file, "utf8"))),
    );

    expect(offenders.map((file) => file.replace(`${SRC}/`, ""))).toEqual([]);
  });
});

describe("readEnv", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the variable when `process` is present", () => {
    vi.stubGlobal("process", { env: { EXAMPLE_FLAG: "value" } });
    expect(readEnv("EXAMPLE_FLAG")).toBe("value");
  });

  it("returns undefined when `process` is absent, instead of throwing", () => {
    vi.stubGlobal("process", undefined);
    expect(() => readEnv("EXAMPLE_FLAG")).not.toThrow();
    expect(readEnv("EXAMPLE_FLAG")).toBeUndefined();
  });

  it("survives a `process` stub with no `env`", () => {
    // Some sandboxes and bundler shims define a stub `process` without `env`.
    vi.stubGlobal("process", {});
    expect(readEnv("EXAMPLE_FLAG")).toBeUndefined();
  });

  it("returns undefined for a variable that is not set", () => {
    vi.stubGlobal("process", { env: {} });
    expect(readEnv("NOT_SET_ANYWHERE")).toBeUndefined();
  });
});

describe("redaction default", () => {
  it("stays ON when the flag cannot be read", async () => {
    // A browser cannot read the flag. That must mean "unset" — never "disabled", or credentials
    // would leak exactly where they are most visible.
    const { redactSecrets } = await import("../../src/internal/security/redact.js");
    const redacted = redactSecrets("token sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789");

    expect(redacted).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
  });
});
