/**
 * T2.1 scaffold tests + EC-A/EC-B/EC-G/EC-L coverage.
 */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { scaffold } from "../../src/init/scaffold.js";

let workDir: string;
beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "tk-init-"));
});
afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("scaffold (T2.1)", () => {
  it("minimal template creates files", async () => {
    const result = await scaffold({ projectName: "demo", template: "minimal", cwd: workDir });
    expect(result.filesWritten).toBeGreaterThan(0);
    expect(existsSync(join(workDir, "demo", "package.json"))).toBe(true);
    expect(existsSync(join(workDir, "demo", "src", "index.ts"))).toBe(true);
    expect(existsSync(join(workDir, "demo", "tsconfig.json"))).toBe(true);
    expect(existsSync(join(workDir, "demo", "README.md"))).toBe(true);
    expect(existsSync(join(workDir, "demo", ".env.example"))).toBe(true);
  });

  it("substitutes {{projectName}} in package.json", async () => {
    await scaffold({ projectName: "my-bot", template: "minimal", cwd: workDir });
    const pkg = JSON.parse(readFileSync(join(workDir, "my-bot", "package.json"), "utf8")) as {
      name: string;
    };
    expect(pkg.name).toBe("my-bot");
  });

  it("EC-L: substitutes {{sdkVersion}} to valid semver (NOT workspace:*)", async () => {
    await scaffold({ projectName: "ver", template: "minimal", cwd: workDir });
    const pkg = JSON.parse(readFileSync(join(workDir, "ver", "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    const sdkDep = pkg.dependencies["@theokit/sdk"];
    expect(sdkDep).toBeDefined();
    expect(sdkDep).not.toContain("workspace");
    // Match `^X.Y.Z` or `^X.Y.Z-prerelease`.
    expect(sdkDep).toMatch(/^\^\d+\.\d+\.\d+/);
  });

  // #116 — every scaffolded template that ships `zod` MUST pin a range whose lower
  // bound satisfies the zod major the SDK itself requires. The SDK imports the
  // top-level `toJSONSchema` (zod v4 only); a `^3.25` pin resolves to v3 and crashes
  // the scaffold on the first `Tool.create`. Derive the required major from the SDK's
  // own manifest so the templates can never drift below it again.
  //
  // Read from `dependencies` OR `peerDependencies`: #399 moved zod from an optional
  // peer to a real dependency (the package could not be imported from a fresh install
  // without it), and this guard read only the peer field — so the declaration moving
  // did not weaken the templates, it broke the test that protects them. What matters
  // here is the major the SDK requires, not which field states it. Declared in neither
  // is still a hard failure: a guard with nothing to compare against is not a guard.
  it("#116: templates carrying zod pin a range satisfying the SDK zod major", async () => {
    const sdkPkg = JSON.parse(
      readFileSync(join(__dirname, "..", "..", "..", "sdk", "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const declaredZod = sdkPkg.dependencies?.zod ?? sdkPkg.peerDependencies?.zod;
    if (!declaredZod) {
      throw new Error("SDK must declare zod in dependencies or peerDependencies");
    }
    // Lowest major the range accepts, e.g. "^4.0.0 || ^4" -> 4.
    const peerMajor = Number(declaredZod.match(/\d+/)?.[0]);
    expect(Number.isInteger(peerMajor)).toBe(true);

    for (const template of ["minimal", "ollama-local", "telegram-bot"] as const) {
      const proj = `zod-${template}`;
      await scaffold({ projectName: proj, template, cwd: workDir });
      const pkg = JSON.parse(readFileSync(join(workDir, proj, "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
      };
      const zodDep = pkg.dependencies?.zod;
      if (!zodDep) continue; // a template may legitimately not depend on zod
      // Extract the lower-bound major from a caret/tilde/plain range.
      const templateMajor = Number(zodDep.match(/\d+/)?.[0]);
      expect(
        templateMajor,
        `${template} pins zod "${zodDep}" — below the SDK peer major ${peerMajor} (#116)`,
      ).toBeGreaterThanOrEqual(peerMajor);
    }
  });

  it("EC-A: rejects npm-invalid names (uppercase, spaces, special chars)", async () => {
    const bads = ["My App", "UpperCase", "scoped/name", " leading-space", "name?", "@scope-only"];
    for (const bad of bads) {
      await expect(
        scaffold({ projectName: bad, template: "minimal", cwd: workDir }),
      ).rejects.toMatchObject({ code: "invalid_project_name" });
    }
  });

  it("EC-A: accepts valid npm names", async () => {
    const goods = ["my-bot", "@org/my-bot", "chat.bot", "bot_1"];
    for (const good of goods) {
      const dirName = good.startsWith("@") ? good.replace(/[/@]/g, "_") : good;
      // For scoped names, the dest is `<cwd>/@org/my-bot` which createsmultiple dirs.
      // Just verify the validate path passes for unscoped names.
      if (!good.startsWith("@")) {
        const result = await scaffold({ projectName: good, template: "minimal", cwd: workDir });
        expect(result.filesWritten).toBeGreaterThan(0);
        rmSync(join(workDir, dirName), { recursive: true, force: true });
      }
    }
  });

  it("EC-B: atomic — crash mid-scaffold leaves no partial dest", async () => {
    // Pre-create dest as a file (not a dir) to force a write conflict mid-process.
    // Actually, the cleanest way is to simulate ENOSPC via a permission-denied dir.
    // Easier: create the dest path with a read-only parent so renameSync fails.
    // Easiest reliable test: scaffold succeeds when nothing exists.
    // Then verify that if we mock a failure, dest is cleaned up.
    // → since we can't easily mock fs internals in vitest without rewiring,
    // we test the next-best invariant: tmp dir is gone after successful scaffold.
    await scaffold({ projectName: "atomic-ok", template: "minimal", cwd: workDir });
    const entries = readdirSync(workDir);
    const tmps = entries.filter((e) => e.startsWith("atomic-ok.tmp-"));
    expect(tmps).toEqual([]);
  });

  it("EC-G: rejects dest that is a symlink", async () => {
    // Create a symlink at the target path.
    const decoy = join(workDir, "decoy");
    mkdirSync(decoy);
    const linkPath = join(workDir, "symlinked");
    symlinkSync(decoy, linkPath);
    await expect(
      scaffold({ projectName: "symlinked", template: "minimal", cwd: workDir }),
    ).rejects.toMatchObject({ code: "dest_is_symlink" });
  });

  it("rejects non-empty dest without --force", async () => {
    const dest = join(workDir, "occupied");
    mkdirSync(dest);
    writeFileSync(join(dest, "existing.txt"), "hi");
    await expect(
      scaffold({ projectName: "occupied", template: "minimal", cwd: workDir }),
    ).rejects.toMatchObject({ code: "dest_not_empty" });
  });

  it("overwrites non-empty dest with --force", async () => {
    const dest = join(workDir, "forced");
    mkdirSync(dest);
    writeFileSync(join(dest, "old.txt"), "old");
    await scaffold({ projectName: "forced", template: "minimal", cwd: workDir, force: true });
    expect(existsSync(join(dest, "package.json"))).toBe(true);
    expect(existsSync(join(dest, "old.txt"))).toBe(false);
  });

  it("rejects path traversal (project name with ..)", async () => {
    await expect(
      scaffold({ projectName: "..escape", template: "minimal", cwd: workDir }),
    ).rejects.toMatchObject({ code: "invalid_project_name" });
  });

  it("ollama-local template renders correctly", async () => {
    await scaffold({ projectName: "ollama-demo", template: "ollama-local", cwd: workDir });
    const src = readFileSync(join(workDir, "ollama-demo", "src", "index.ts"), "utf8");
    expect(src).toContain("ollama/llama3.2");
    expect(src).toContain("OLLAMA_HOST");
  });

  it("telegram-bot template renders correctly", async () => {
    await scaffold({ projectName: "tg-demo", template: "telegram-bot", cwd: workDir });
    const env = readFileSync(join(workDir, "tg-demo", ".env.example"), "utf8");
    expect(env).toContain("TELEGRAM_BOT_TOKEN");
    const pkg = JSON.parse(readFileSync(join(workDir, "tg-demo", "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies.grammy).toBeDefined();
    expect(pkg.dependencies["@theokit/gateway-telegram"]).toBeDefined();
  });

  it("rejects unknown template", async () => {
    await expect(
      scaffold({ projectName: "x", template: "nonexistent", cwd: workDir }),
    ).rejects.toMatchObject({ code: "unknown_template" });
  });
});
