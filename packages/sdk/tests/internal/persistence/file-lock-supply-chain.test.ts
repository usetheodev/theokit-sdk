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
 * T5.9 adds ONE layer of defense after the dynamic import succeeds:
 *
 * Structural check: `typeof lib.lock === "function"` AND
 * `typeof lib.unlock === "function"`. If the imported module doesn't expose the API surface we
 * depend on, it's treated as "not installed" (fallback to in-process mutex) + a WARN with a
 * supply-chain advisory is emitted. It emits a one-shot stderr warning and falls back gracefully to
 * in-process `withCwdMutex`; it never throws — supply-chain validation is advisory + fallback, not
 * blocking. `validateLockModule` implements it (`file-lock.ts:124`), it is wired at `:89-102`, and
 * the six cases below exercise it.
 *
 * ## A SECOND LAYER WAS DESCRIBED HERE AND NEVER EXISTED. Removed 2026-09-01.
 *
 * This docblock claimed, in the present tense and as one of "two layers of defense", a version
 * floor: *"if the module exports a numeric `version` or the package.json peer dep declares a range,
 * the SDK verifies the imported module satisfies the floor. Currently: `>=11.0.0`"*. Three things
 * were wrong with it, and they compound:
 *
 *  1. **No such check exists.** `getProperLockfile` (`file-lock.ts:80-111`) imports, calls
 *     `validateLockModule`, and caches. There is no version read and no comparison.
 *  2. **The module exports no version to read.** `proper-lockfile`'s exports are
 *     `check, checkSync, default, lock, lockSync, unlock, unlockSync`. The premise the paragraph
 *     opened with — "if the module exports a numeric `version`" — is not satisfiable for this
 *     dependency.
 *  3. **The stated floor contradicts the declared dependency.** This package declares
 *     `proper-lockfile: ^4.1.2` in both `peerDependencies` and `devDependencies`. The docblock
 *     asserted `>=11.0.0`, seven majors above what the SDK actually depends on, so a reader
 *     checking their install against this file would conclude their correct version was wrong.
 *
 * It is deleted rather than implemented, and that is the substantive call. A version the MODULE
 * reports is not a defence against the threat this file names: an attacker who can replace
 * `proper-lockfile` on disk can also set whatever version string the check would read. What the
 * range in `package.json` buys is enforcement at INSTALL time, by the package manager, against
 * accidental drift — a different guarantee, already in place, and not one this file can add to at
 * runtime. Writing the check would have produced a control that reads as a supply-chain defence and
 * is not one, which is worse than the absence.
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
