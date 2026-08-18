/**
 * Every publishable package must declare where it comes from — B-121.
 *
 * npm cross-checks a manifest's `repository.url` against the repository recorded in the signed
 * provenance statement. An empty value cannot match, so the PUT is refused with E422 AFTER the
 * statement has been signed and written to the public transparency log:
 *
 *   Error verifying sigstore provenance bundle: Failed to validate repository information:
 *   package.json: "repository.url" is "", expected to match ".../theokit-sdk" from provenance
 *
 * The field was empty in 6 of 12 packages and nothing needed it until provenance was enabled. The
 * failure it produces is the confusing kind: the release run goes red while the package everyone
 * was watching publishes successfully, because each package is published independently.
 *
 * This is a lint rather than a one-time edit because the seventh package added to the workspace
 * would repeat it, and would find out on release day.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const REPO = join(__dirname, "..", "..", "..", "..");
const PACKAGES = join(REPO, "packages");

/** The URL npm compares against. Taken from the root manifest so the two cannot drift. */
const EXPECTED_URL = "git+https://github.com/usetheokit/theokit-sdk.git";

interface Manifest {
  name?: string;
  private?: boolean;
  repository?: { type?: string; url?: string; directory?: string };
}

function publishable(): Array<{ dir: string; manifest: Manifest }> {
  return readdirSync(PACKAGES)
    .map((dir) => {
      try {
        const manifest = JSON.parse(
          readFileSync(join(PACKAGES, dir, "package.json"), "utf8"),
        ) as Manifest;
        return { dir, manifest };
      } catch {
        return undefined;
      }
    })
    .filter((e): e is { dir: string; manifest: Manifest } => e !== undefined)
    .filter((e) => e.manifest.private !== true);
}

describe("publishable packages declare their repository (B-121)", () => {
  const pkgs = publishable();

  it("test_the_workspace_still_has_publishable_packages", () => {
    // Anti-vacuity. If the enumeration ever returns nothing, every case below passes for the wrong
    // reason — the failure mode a lint must not have.
    expect(pkgs.length).toBeGreaterThan(5);
  });

  it.each(
    publishable().map((p) => [p.manifest.name ?? p.dir, p] as const),
  )("test_%s_declares_a_repository_url_that_provenance_can_match", (_name, entry) => {
    expect(entry.manifest.repository?.url).toBe(EXPECTED_URL);
  });

  it.each(
    publishable().map((p) => [p.manifest.name ?? p.dir, p] as const),
  )("test_%s_points_at_its_own_directory", (_name, entry) => {
    // Without `directory`, npm links every package at the repository root, so a reader following
    // the link from the registry lands somewhere that does not contain the code they installed.
    expect(entry.manifest.repository?.directory).toBe(`packages/${entry.dir}`);
  });
});
