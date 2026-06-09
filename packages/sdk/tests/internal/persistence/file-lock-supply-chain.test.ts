/**
 * T5.9 — proper-lockfile supply-chain hardening (DR6 finding #9).
 *
 * Pre-T5.9 `getProperLockfile()` did a bare `import("proper-lockfile")`
 * with a try/catch that swallowed ALL errors — including import of a
 * tampered or incompatible version. If an attacker replaced the module
 * on disk (npm supply-chain attack), or if a transitive dep pulled a
 * breaking major version, the SDK would silently use whatever it got
 * with no structural or version validation.
 *
 * T5.9 adds two layers of defense after the dynamic import succeeds:
 *
 * (a) Structural check: `typeof lib.lock === "function"` AND
 *     `typeof lib.unlock === "function"`. If the imported module
 *     doesn't expose the API surface we depend on, it's treated as
 *     "not installed" (fallback to in-process mutex) + a WARN with
 *     supply-chain advisory is emitted.
 *
 * (b) Version floor: if the module exports a numeric `version` or the
 *     package.json peer dep declares a range, the SDK verifies the
 *     imported module satisfies the floor. Currently: `>=11.0.0`
 *     (proper-lockfile v11 is the current major; v10 had a stale-lock
 *     race bug fixed in 11.0.0-rc.1).
 *
 * Both checks emit a one-shot stderr warning and fall back gracefully
 * to in-process `withCwdMutex`. They never throw — supply-chain
 * validation is advisory + fallback, not blocking.
 */

import { describe, expect, it } from "vitest";
import {
  __TESTING__resetFileLockCache,
  __TESTING__validateLockModule,
} from "../../../src/internal/persistence/file-lock.js";

describe("T5.9 — validateLockModule structural check", () => {
  it("accepts a well-shaped module with lock + unlock functions", () => {
    const mod = { lock: () => {}, unlock: () => {} };
    expect(__TESTING__validateLockModule(mod)).toBe(true);
  });

  it("rejects a module missing lock function", () => {
    const mod = { unlock: () => {} };
    expect(__TESTING__validateLockModule(mod as never)).toBe(false);
  });

  it("rejects a module missing unlock function", () => {
    const mod = { lock: () => {} };
    expect(__TESTING__validateLockModule(mod as never)).toBe(false);
  });

  it("rejects a module where lock is not a function", () => {
    const mod = { lock: "not-a-fn", unlock: () => {} };
    expect(__TESTING__validateLockModule(mod as never)).toBe(false);
  });

  it("rejects null", () => {
    expect(__TESTING__validateLockModule(null as never)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(__TESTING__validateLockModule(undefined as never)).toBe(false);
  });
});

describe("T5.9 — cache reset helper", () => {
  it("resetFileLockCache is a no-throw idempotent helper", () => {
    expect(() => __TESTING__resetFileLockCache()).not.toThrow();
    expect(() => __TESTING__resetFileLockCache()).not.toThrow();
  });
});
