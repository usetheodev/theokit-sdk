/**
 * REGRESSION (#150) — this package's path-guard must NOT be a fork of the canonical one.
 *
 * `src/internal/path-guard.ts` was a vendored copy, consumed by the 9 tools that touch paths.
 * The canonical one (`@theokit/sdk` -> `internal/security/path-guard.ts`) evolved — credential blocklist,
 * case-insensitive normalization, NUL/control-char rejection (T5.5), the root-base fix (#149) — and the
 * copy stood still. Nothing in CI compared the two, so the divergence grew with every fix
 * applied to only one side, and the agent read `.ssh/id_rsa`, `.aws/credentials` and `*.pem` through it.
 *
 * The defect is the DUPLICATION, not its version: reintroducing an up-to-date copy only restarts the
 * divergence clock. That is why this test asserts PARITY with the canonical one, not a list of behaviors.
 */
import {
  isForbiddenPath as canonical,
  safePathJoin as joinCanonico,
  PathTraversalError,
} from "@theokit/sdk/path-safety";
import { describe, expect, it } from "vitest";

import { isForbiddenPath, safePathJoin } from "../src/internal/path-guard.js";

/** Paths the canonical guard blocks — each was genuinely read by the fork before the fix (#150). */
const SECRETS = [
  ".ssh/id_rsa",
  ".ssh/id_ed25519",
  ".aws/credentials",
  ".kube/config",
  ".npmrc",
  "server.pem",
  "client.key",
  "bundle.p12",
  "authorized_keys",
  // bypass by CASE: the fork compared without `toLowerCase()`
  ".GIT/config",
  ".SSH/id_rsa",
];

/** Ordinary code paths — must stay allowed, otherwise the fix broke legitimate use. */
const LEGITIMOS = ["src/app.ts", "README.md", "tests/foo.test.ts", "packages/a/src/b.ts"];

describe("#150 — path-guard with no fork of the canonical one", () => {
  it("test_it_blocks_every_secret_the_canonical_one_blocks", () => {
    for (const p of SECRETS) {
      expect(canonical(p), `invalid fixture: the canonical guard should block ${p}`).toBe(true);
      expect(isForbiddenPath(p), `${p} escaped this package guard`).toBe(true);
    }
  });

  it("test_does_not_block_legitimate_code", () => {
    for (const p of LEGITIMOS) {
      expect(canonical(p)).toBe(false);
      expect(isForbiddenPath(p), `${p} was blocked when it should not have been`).toBe(false);
    }
  });

  it("test_it_rejects_nul_and_control_chars_like_the_canonical_one", () => {
    // T5.5 — present in the canonical guard at 6 call sites, absent in the fork.
    // B-079 — was bare `.toThrow()`. Both `joinCanonico` and this package's re-export
    // (`safePathJoin`, see `src/internal/path-guard.ts`) throw the SAME `PathTraversalError`
    // (code "path_traversal") from `@theokit/sdk/path-safety` — that identity IS the parity
    // this file exists to lock.
    const NUL = String.fromCharCode(0);
    const CONTROL = String.fromCharCode(0x1f);
    expect(() => joinCanonico("/tmp", `a${NUL}b`)).toThrow(PathTraversalError);
    expect(() => joinCanonico("/tmp", `a${NUL}b`)).toThrow(
      expect.objectContaining({ code: "path_traversal" }),
    );
    expect(() => safePathJoin("/tmp", `a${NUL}b`)).toThrow(PathTraversalError);
    expect(() => safePathJoin("/tmp", `a${NUL}b`)).toThrow(
      expect.objectContaining({ code: "path_traversal" }),
    );
    expect(() => safePathJoin("/tmp", `a${CONTROL}b`)).toThrow(PathTraversalError);
    expect(() => safePathJoin("/tmp", `a${CONTROL}b`)).toThrow(
      expect.objectContaining({ code: "path_traversal" }),
    );
  });

  it("test_a_filesystem_root_base_accepts_a_path", () => {
    // #149 — the fork refused EVERY path when the base was `/`.
    expect(safePathJoin("/", "a.txt")).toBe(joinCanonico("/", "a.txt"));
  });

  it("test_it_keeps_refusing_a_directory_escape", () => {
    // The anti-loosening anchor: parity must not have come from turning the defense off.
    // B-079 — was bare `.toThrow()`.
    expect(() => safePathJoin("/tmp/base", "..", "etc", "passwd")).toThrow(PathTraversalError);
    expect(() => safePathJoin("/tmp/base", "..", "etc", "passwd")).toThrow(
      expect.objectContaining({ code: "path_traversal" }),
    );
    expect(() => joinCanonico("/tmp/base", "..", "etc", "passwd")).toThrow(PathTraversalError);
    expect(() => joinCanonico("/tmp/base", "..", "etc", "passwd")).toThrow(
      expect.objectContaining({ code: "path_traversal" }),
    );
  });
});
