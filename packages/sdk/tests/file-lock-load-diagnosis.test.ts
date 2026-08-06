import { describe, expect, it } from "vitest";

import { __TESTING__describeLockLoadFailure } from "../src/internal/persistence/file-lock.js";

/**
 * theokit-sdk#174 — the fallback warning must report what was OBSERVED, not what was assumed.
 *
 * A consumer wired the diagnostics sink and the first message of a real turn was
 * "proper-lockfile not installed". The package WAS installed, declared, and resolvable from the
 * SDK's own dist. They spent the debugging session verifying the one thing that was already true,
 * because the message asserted a cause the code never checked: `getProperLockfile` wrapped the
 * dynamic import in `catch { cached = null }`, so EVERY failure — a broken install, an interop
 * problem, a bundler that rewrote the specifier — was reported as absence.
 *
 * That is an Unbreakable Rule 8 violation in this repo's own code: the error was swallowed, and the
 * message that replaced it named a cause instead of the observation. Cross-process locking is
 * silently off in a process that runs a TUI, an exec path and ACP over one session directory — the
 * exact case the lock exists for — and the only signal contradicted `require.resolve`.
 *
 * These tests pin the message. They do NOT assert a root cause for that consumer's environment:
 * a clean install resolves the module correctly under both ESM and CJS, so the failure is
 * environment-specific and is exactly what the improved message is meant to surface.
 */
describe("#174 — the lock-unavailable diagnostic reports the observed failure", () => {
  it("test_a_genuine_absence_still_reads_as_not_installed", () => {
    const err = Object.assign(new Error("Cannot find package 'proper-lockfile'"), {
      code: "ERR_MODULE_NOT_FOUND",
    });
    const msg = __TESTING__describeLockLoadFailure(err);
    expect(msg).toContain("not installed");
    expect(msg).toContain("proper-lockfile");
  });

  it("test_the_commonjs_absence_code_also_reads_as_not_installed", () => {
    // CJS resolution reports MODULE_NOT_FOUND; the ESM loader reports ERR_MODULE_NOT_FOUND. Both
    // mean the same thing and the SDK ships both an ESM and a CJS chunk.
    const err = Object.assign(new Error("Cannot find module 'proper-lockfile'"), {
      code: "MODULE_NOT_FOUND",
    });
    expect(__TESTING__describeLockLoadFailure(err)).toContain("not installed");
  });

  it("test_a_non_absence_failure_never_claims_it_is_not_installed", () => {
    // The defect this issue is about: an installed-but-unloadable module reported as missing.
    const err = Object.assign(new Error("boom while evaluating module"), {
      code: "ERR_REQUIRE_ESM",
    });
    const msg = __TESTING__describeLockLoadFailure(err);
    expect(msg, "an unloadable module is not an absent one").not.toContain("not installed");
  });

  it("test_a_non_absence_failure_reports_the_observed_error", () => {
    const err = Object.assign(new Error("boom while evaluating module"), {
      code: "ERR_REQUIRE_ESM",
    });
    const msg = __TESTING__describeLockLoadFailure(err);
    // Whoever is debugging needs the code AND the message — that is what points at the real cause
    // instead of sending them to re-check the install.
    expect(msg).toContain("ERR_REQUIRE_ESM");
    expect(msg).toContain("boom while evaluating module");
  });

  it("test_a_thrown_non_error_still_produces_a_usable_message", () => {
    const msg = __TESTING__describeLockLoadFailure("just a string");
    expect(msg).toContain("just a string");
    expect(msg).not.toContain("not installed");
  });

  it("test_every_variant_says_the_cross_process_lock_is_off", () => {
    // The consequence is the same in all cases and is the part a consumer must not miss: concurrent
    // processes over the same session directory are no longer serialized.
    for (const err of [
      Object.assign(new Error("x"), { code: "ERR_MODULE_NOT_FOUND" }),
      Object.assign(new Error("x"), { code: "ERR_REQUIRE_ESM" }),
      "plain",
    ]) {
      expect(__TESTING__describeLockLoadFailure(err)).toContain("cross-process");
    }
  });
});
