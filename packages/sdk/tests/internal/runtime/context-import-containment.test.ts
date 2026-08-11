/**
 * `@path` imports are confined to the project root.
 *
 * The `@path` resolver expands a line that is exactly `@something` into that file's
 * content, and the expansion is inlined into the agent's system prompt. Two of the
 * default discovery specs — `CLAUDE.md` and `GEMINI.md` — carry `followImports: true`
 * and are found by `git-root-walk`, i.e. they are files that live INSIDE the repository
 * the agent was pointed at.
 *
 * A repository is untrusted input. Before this test, `resolveImportPath` accepted
 * `~/...` and absolute paths and applied no root at all, so a cloned repository whose
 * `CLAUDE.md` contained a single line `@~/.ssh/id_rsa` had that file read into the
 * prompt — and from there to the model provider. The traversal guard that already
 * existed (`isSafePattern`, `TRAVERSAL_RE`) guards the discovery PATTERN, one layer
 * away from the import TARGET, so it never saw this.
 *
 * These tests use fixture files created outside the project root rather than real
 * secrets; the assertion is on containment, not on any particular filename.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveImports } from "../../../src/internal/runtime/context/context-import-resolver.js";

const OPTS = { visited: new Set<string>(), depth: 0, maxBytesPerFile: 64_000 };

let root: string;
let outside: string;
let projectRoot: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "theokit-import-containment-"));
  projectRoot = join(root, "project");
  outside = join(root, "outside");
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, "private.txt"), "SENTINEL-OUTSIDE-THE-ROOT", "utf8");
  writeFileSync(join(projectRoot, "allowed.md"), "SENTINEL-INSIDE-THE-ROOT", "utf8");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function base(): string {
  return join(projectRoot, "CLAUDE.md");
}

describe("resolveImports confines an import to the declared root", () => {
  it("test_an_absolute_import_outside_the_root_is_refused", async () => {
    const out = await resolveImports(`@${join(outside, "private.txt")}`, base(), {
      ...OPTS,
      visited: new Set(),
      projectRoot,
    });

    expect(
      out,
      "an absolute @import escaped the project root — a repository can name any path on the " +
        "machine and have it inlined into the system prompt",
    ).not.toContain("SENTINEL-OUTSIDE-THE-ROOT");
    expect(out).toContain("outside the project root");
  });

  it("test_a_relative_import_climbing_out_of_the_root_is_refused", async () => {
    const out = await resolveImports("@../outside/private.txt", base(), {
      ...OPTS,
      visited: new Set(),
      projectRoot,
    });

    expect(out, "a `..` @import escaped the project root").not.toContain(
      "SENTINEL-OUTSIDE-THE-ROOT",
    );
  });

  it("test_a_home_relative_import_is_refused", async () => {
    // `~/` is the shape that reaches a user's credentials without any `..` at all, and it
    // was handled explicitly by the resolver rather than rejected.
    //
    // The probe is a FIXTURE under a redirected HOME, never a real path. Writing
    // `@~/.ssh/id_rsa` here reads the developer's actual private key and prints it in the
    // failure diff — measured, on the run that first proved this defect. A regression test
    // for an exfiltration bug must not be an exfiltration bug.
    const fakeHome = join(root, "home");
    mkdirSync(join(fakeHome, ".ssh"), { recursive: true });
    writeFileSync(join(fakeHome, ".ssh", "id_rsa"), "SENTINEL-HOME-SECRET", "utf8");
    const realHome = process.env.HOME;
    process.env.HOME = fakeHome;
    try {
      const out = await resolveImports("@~/.ssh/id_rsa", base(), {
        ...OPTS,
        visited: new Set(),
        projectRoot,
      });

      expect(out).toContain("outside the project root");
      expect(out).not.toContain("SENTINEL-HOME-SECRET");
    } finally {
      if (realHome === undefined) delete process.env.HOME;
      else process.env.HOME = realHome;
    }
  });

  it("test_a_symlink_that_points_out_of_the_root_is_refused", async () => {
    // Containment has to hold on the REAL path: a link whose name resolves inside the root
    // but whose target does not is the shape that passes a string comparison.
    const { symlinkSync } = await import("node:fs");
    symlinkSync(join(outside, "private.txt"), join(projectRoot, "link.md"));

    const out = await resolveImports("@link.md", base(), {
      ...OPTS,
      visited: new Set(),
      projectRoot,
    });

    expect(
      out,
      "a symlink inside the root resolved to a file outside it and was inlined",
    ).not.toContain("SENTINEL-OUTSIDE-THE-ROOT");
  });

  it("test_an_import_inside_the_root_still_resolves", async () => {
    // Anti-vacuity: refusing everything would pass every assertion above.
    const out = await resolveImports("@allowed.md", base(), {
      ...OPTS,
      visited: new Set(),
      projectRoot,
    });

    expect(out).toContain("SENTINEL-INSIDE-THE-ROOT");
  });

  it("test_no_declared_root_keeps_the_previous_behaviour", async () => {
    // `projectRoot` is optional so an embedder that resolves its own trust boundary — or a
    // caller outside the discovery path — is not broken by this change. The discovery
    // runner always supplies one; see `context-discovery-runner.ts`.
    const out = await resolveImports(`@${join(outside, "private.txt")}`, base(), {
      ...OPTS,
      visited: new Set(),
    });

    expect(out).toContain("SENTINEL-OUTSIDE-THE-ROOT");
  });
});
