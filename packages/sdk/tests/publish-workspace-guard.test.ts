import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

/**
 * Regression harness for the `workspace:` publish guard (B-111).
 *
 * The defect it prevents is unrecoverable: a manifest that reaches npm still saying
 * `"@theokit/sdk": "workspace:^"` breaks every install of that version, and a published version can
 * only be deprecated, never corrected. So the guard's own correctness is worth pinning by PLANTING
 * the defect rather than by reading the code — the same discipline the sibling repo's script cites
 * as "measured, not reasoned".
 *
 * Two rules, tested separately because either alone is blind to what the other catches:
 *
 *   1. The TOOL — a manifest carrying `workspace:` is safe under pnpm (which rewrites while packing)
 *      and broken under npm (which ships it verbatim).
 *   2. The ARTIFACT — the packed tarball must be clean regardless, so a pnpm rewrite that silently
 *      stops working is caught rather than assumed.
 */
const REPO = resolve(__dirname, "..", "..", "..");

const guard = await import(join(REPO, "tools", "check-publish-no-workspace.mjs"));

const sandbox = mkdtempSync(join(tmpdir(), "wsguard-test-"));
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

/** A throwaway package directory carrying exactly the manifest given. */
function fixture(manifest: Record<string, unknown>): string {
  const dir = mkdtempSync(join(sandbox, "pkg-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest, null, 2));
  return dir;
}

const WITH_WORKSPACE = {
  name: "@theokit/probe-leaky",
  version: "0.0.0",
  dependencies: { "@theokit/sdk": "workspace:^" },
};

const CLEAN = {
  name: "@theokit/probe-clean",
  version: "0.0.0",
  dependencies: { "@theokit/sdk": "^4.42.0" },
};

describe("workspace: publish guard — rule 1, the publishing tool", () => {
  it("test_publishing_with_npm_is_refused_when_the_manifest_carries_workspace", () => {
    // The planted defect. npm ships the manifest verbatim, so this publish would be unrecoverable.
    const problems = guard.checkPackage(fixture(WITH_WORKSPACE), "npm", { pack: false });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("REFUSING to publish with npm");
    // The message must name the offending range — a refusal that does not say WHICH dependency
    // sends the operator hunting through five manifests.
    expect(problems[0]).toContain("dependencies.@theokit/sdk = workspace:^");
  });

  it("test_publishing_with_pnpm_is_allowed_for_the_same_manifest", () => {
    // Anti-vacuity. If this also refused, the guard would just be blocking every publish and the
    // case above would prove nothing.
    expect(guard.checkPackage(fixture(WITH_WORKSPACE), "pnpm", { pack: false })).toEqual([]);
  });

  it("test_publishing_with_npm_is_allowed_when_no_workspace_range_is_declared", () => {
    // The guard must not punish the 7 of 12 packages that carry no internal dependency.
    expect(guard.checkPackage(fixture(CLEAN), "npm", { pack: false })).toEqual([]);
  });

  it("test_an_unknown_publishing_tool_does_not_trip_rule_one", () => {
    // `npm_config_user_agent` is absent when the script is run directly. Refusing then would make
    // the guard unusable from a test or a manual `node tools/...` run, and rule 2 still applies.
    expect(guard.checkPackage(fixture(WITH_WORKSPACE), null, { pack: false })).toEqual([]);
  });

  it("test_a_private_package_is_skipped", () => {
    // Nothing to leak — it is never published.
    const dir = fixture({ ...WITH_WORKSPACE, private: true });
    expect(guard.checkPackage(dir, "npm", { pack: false })).toEqual([]);
  });
});

describe("workspace: publish guard — rule 2, the packed artifact", () => {
  it("test_pnpm_actually_rewrites_workspace_ranges_for_a_real_package", {
    timeout: 120_000,
  }, () => {
    // The load-bearing empirical claim behind rule 1's pnpm exemption. If a pnpm upgrade ever stops
    // rewriting, this goes red BEFORE a release ships the leak, which is the entire point of
    // checking the artifact rather than trusting the tool.
    const cli = join(REPO, "packages", "cli");
    expect(guard.checkPackage(cli, "pnpm", { pack: true })).toEqual([]);
  });
});

describe("workspace: publish guard — coverage", () => {
  it("test_every_publishable_package_is_enumerated", () => {
    const dirs: string[] = guard.publishablePackages();
    // The guard is worthless if it silently inspects an empty list — the failure mode that would
    // make it pass forever.
    expect(dirs.length).toBeGreaterThan(5);
    expect(dirs.some((d) => d.endsWith("/cli"))).toBe(true);
  });
});

/**
 * B-118 — no `.npmrc` in this repository may declare a registry auth token.
 *
 * The line that was here, `//registry.npmjs.org/:_authToken=${NPM_TOKEN}`, is correct for CI and
 * harmful everywhere else, and the two package managers disagree about how — which is why this is
 * pinned rather than remembered.
 *
 * MEASURED with a user credential present and `NPM_TOKEN` unset:
 *
 *   npm  →  `//registry.npmjs.org/:_authToken = (protected) ; overridden by project`
 *           the unset variable becomes an EMPTY token and outranks the user's real one, so the
 *           registry answers an unauthenticated PUT with 404 — which reads as "this package does
 *           not exist for you" and sends the investigation to token scopes and package ownership.
 *   pnpm →  drops the unresolvable line with a warning; the user credential survives.
 *
 * That asymmetry also corrects B-118's own account, which had the two tools the other way round.
 *
 * CI does not need the line: `actions/setup-node` with `registry-url` writes the runner's user-level
 * `.npmrc` to read `NODE_AUTH_TOKEN`, which the release workflow sets from the secret.
 */
describe("B-118 — the repository declares no registry credential", () => {
  const REPO_ROOT = resolve(import.meta.dirname, "../../..");

  it("test_no_npmrc_in_the_repository_declares_an_auth_token", () => {
    const candidates = [".npmrc", "packages/sdk/.npmrc", ".github/.npmrc"];
    const offenders = candidates.filter((rel) => {
      const body = readIfPresent(join(REPO_ROOT, rel));
      return body !== null && /_authToken\s*=/.test(body);
    });

    expect(
      offenders,
      "a committed .npmrc declaring an auth token overrides the developer's own credential with " +
        "an empty string under npm, and the registry reports that as a 404 about package ownership",
    ).toEqual([]);
  });
});

function readIfPresent(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
