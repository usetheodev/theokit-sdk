/**
 * Every registered template is a real, complete, scaffoldable directory.
 *
 * This replaces `packages/sdk/tests/e2e/templates-structure.e2e.test.ts`, which moved here with the
 * templates themselves. It also closes the hole that file had: it asserted directories, files and a
 * line count, and stayed green while four of the five templates it guarded imported symbols the SDK
 * does not export. Shape is not correctness — `tools/check-doc-api-drift.mjs` asks the compiler
 * whether the imports resolve, and this asks whether the thing `theokit init` copies is complete.
 *
 * The registry-vs-filesystem check is the one that would have caught the drift found on
 * 2026-08-20: a second templates directory existed under `packages/sdk`, holding five templates the
 * CLI had never heard of, while the CLI's own help text named three and its registry named three.
 * Three sources, three answers, nothing comparing them.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DEFAULT_TEMPLATE, TEMPLATES } from "../../src/init/templates.js";

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../templates");

/** Files `theokit init` copies for every template; a missing one scaffolds a broken project. */
const REQUIRED_FILES = ["package.json", "tsconfig.json", "README.md", "src/index.ts"];

describe("template registry ↔ filesystem", () => {
  it("every registered template has a directory, and every directory is registered", () => {
    const onDisk = readdirSync(TEMPLATES_DIR).sort();
    const registered = TEMPLATES.map((t) => t.name).sort();

    // Both directions on purpose: a registered name with no directory fails at scaffold time with
    // "Template directory not found", and a directory nobody registered is unreachable — which is
    // exactly how five templates sat unusable for months.
    expect(registered).toEqual(onDisk);
  });

  it("the default template is one of the registered ones", () => {
    expect(TEMPLATES.map((t) => t.name)).toContain(DEFAULT_TEMPLATE);
  });

  it("every template carries a description and a hint", () => {
    for (const t of TEMPLATES) {
      expect(t.description.length, `${t.name} description`).toBeGreaterThan(10);
      expect(t.hint.length, `${t.name} hint`).toBeGreaterThan(10);
    }
  });
});

describe.each(TEMPLATES.map((t) => t.name))("template: %s", (name) => {
  const dir = join(TEMPLATES_DIR, name);

  it.each(REQUIRED_FILES)("has %s", (file) => {
    expect(existsSync(join(dir, file))).toBe(true);
  });

  it("substitutes the project name rather than hardcoding one", () => {
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      name: string;
      dependencies?: Record<string, string>;
    };
    expect(manifest.name).toBe("{{projectName}}");
  });

  it("pins only @theokit/sdk to the substituted SDK version", () => {
    // `{{sdkVersion}}` becomes the SDK's own semver. Applying it to any OTHER package asks the
    // registry for a version that does not exist — measured on `telegram-bot`, which pinned
    // `@theokit/gateway` to `^{{sdkVersion}}` (4.53.1) against a published 0.5.1, so a scaffolded
    // project could not install at all.
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...manifest.dependencies, ...manifest.devDependencies };
    for (const [dep, range] of Object.entries(deps)) {
      if (dep === "@theokit/sdk") continue;
      expect(range, `${name} pins ${dep}`).not.toContain("{{sdkVersion}}");
    }
  });

  it("the README is written for the scaffolded project, not for this repo", () => {
    const readme = readFileSync(join(dir, "README.md"), "utf8");
    expect(readme).toContain("{{projectName}}");
  });
});
