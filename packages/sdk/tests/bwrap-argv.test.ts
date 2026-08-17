// MIGRATED from the agent-builder in M75 T4.1 — SECOND attempt, and the reason is in the review.
//
// The first "migration" wrote NEW tests with injected probes and deleted these 24. The review
// proved by MUTATION what that cost: swapping buildSeccompFilter for `Buffer.alloc(8)` — a filter
// that denies NOTHING, no arch guard, no ptrace, no io_uring, no AF_INET — passed 9/9. The
// entire semantics of the cBPF filter was vacuous.
//
// Here the change is ONLY in the import block (D4). No body, no assertion.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildBwrapArgv,
  detectBwrap,
  detectBwrapMemoized,
  resetBwrapMemo,
} from "../src/sandbox/bwrap.js";

/**
 * M53 T0.1 — pure bwrap argv per policy + honest detection (3 probes:
 * which fora do cwd, `--help` ⊃ `--perms`, probe de user-namespace com timeout).
 * Subset without the 2-stage seccomp.
 */

const CWD = "/home/u/proj";

describe("buildBwrapArgv", () => {
  it("workspace_write_argv_exact", () => {
    const argv = buildBwrapArgv("workspace-write", { cwd: CWD, gitDirExists: true });
    expect(argv).not.toBeNull();
    const a = argv!;
    // core, always present (bwrap.rs:318-332,446-452)
    for (const flag of ["--new-session", "--die-with-parent", "--unshare-user", "--unshare-pid"]) {
      expect(a).toContain(flag);
    }
    expect(a.join(" ")).toContain("--ro-bind / /");
    expect(a.join(" ")).toContain("--dev /dev");
    expect(a.join(" ")).toContain("--proc /proc");
    // network off by default (bwrap.rs:325-327)
    expect(a).toContain("--unshare-net");
    // writable roots: cwd + /tmp (protocol.rs:1189-1214)
    expect(a.join(" ")).toContain(`--bind ${CWD} ${CWD}`);
    expect(a.join(" ")).toContain("--bind /tmp /tmp");
    // .git protected ON TOP OF the RW bind (permissions.rs:22-31; bwrap.rs:571-597) — order matters
    const joined = a.join(" ");
    expect(joined).toContain(`--ro-bind ${CWD}/.git ${CWD}/.git`);
    expect(joined.indexOf(`--bind ${CWD} ${CWD}`)).toBeLessThan(
      joined.indexOf(`--ro-bind ${CWD}/.git`),
    );
    // ends at the command separator
    expect(a[a.length - 1]).toBe("--");
  });

  it("workspace_write_without_git_dir_has_no_git_robind", () => {
    const a = buildBwrapArgv("workspace-write", { cwd: CWD, gitDirExists: false })!;
    expect(a.join(" ")).not.toContain(".git");
  });

  it("read_only_has_no_rw_binds", () => {
    const a = buildBwrapArgv("read-only", { cwd: CWD, gitDirExists: true })!;
    expect(a.join(" ")).toContain("--ro-bind / /");
    expect(a).not.toContain("--bind"); // zero writable roots (protocol.rs:1176)
    expect(a).toContain("--unshare-net");
  });

  it("danger_returns_null", () => {
    // danger-full-access skips bwrap entirely (bwrap.rs:245-252)
    expect(buildBwrapArgv("danger-full-access", { cwd: CWD, gitDirExists: true })).toBeNull();
  });

  it("network_true_removes_unshare_net", () => {
    const a = buildBwrapArgv("workspace-write", { cwd: CWD, network: true, gitDirExists: false })!;
    expect(a).not.toContain("--unshare-net");
  });
});

describe("detectBwrap (fail-closed on each probe)", () => {
  const okProbes = {
    which: () => "/usr/bin/bwrap",
    helpText: () => "--perms --ro-bind --unshare-net",
    userns: () => true,
  };

  it("all_probes_pass_returns_bin", () => {
    expect(detectBwrap(okProbes)).toEqual({ ok: true, bin: "/usr/bin/bwrap" });
  });

  it("which_missing_fails_closed", () => {
    const r = detectBwrap({ ...okProbes, which: () => null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not found/i);
  });

  it("help_without_perms_fails_closed", () => {
    // launcher.rs:108-124 — requires --perms
    const r = detectBwrap({ ...okProbes, helpText: () => "--ro-bind only" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/--perms/);
  });

  it("userns_denied_fails_closed", () => {
    // sandboxing/src/bwrap.rs:74-136 — an active user-namespace probe
    const r = detectBwrap({ ...okProbes, userns: () => false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/namespace/i);
  });

  it("probes_never_throw_out", () => {
    const r = detectBwrap({
      which: () => {
        throw new Error("spawn EACCES");
      },
      helpText: okProbes.helpText,
      userns: okProbes.userns,
    });
    expect(r.ok).toBe(false);
  });
});

describe("M53 review fixes — env confinement + absolute bin", () => {
  it("clearenv_precedes_setenv_allowlist", () => {
    // MEDIUM-3: --clearenv (Codex env_clear) + re-inject only the allowlist, never inherit secrets by name
    const a = buildBwrapArgv("workspace-write", {
      cwd: CWD,
      gitDirExists: false,
      env: { PATH: "/usr/bin", HOME: "/home/u" },
    })!;
    const joined = a.join(" ");
    expect(a).toContain("--clearenv");
    // --clearenv BEFORE any --setenv (otherwise the clear wipes what was set)
    expect(a.indexOf("--clearenv")).toBeLessThan(a.indexOf("--setenv"));
    expect(joined).toContain("--setenv PATH /usr/bin");
    expect(joined).toContain("--setenv HOME /home/u");
    // the network flag is still present (network off by default)
    expect(joined).toContain("--setenv CODEX_SANDBOX_NETWORK_DISABLED 1");
  });

  it("no_clearenv_when_env_absent (retrocompat)", () => {
    const a = buildBwrapArgv("read-only", { cwd: CWD, gitDirExists: false })!;
    expect(a).not.toContain("--clearenv");
  });
});

/**
 * M71 T1.1 — the probe runs once per PROCESS, not per turn.
 *
 * Measured before: `detectBwrap()` costs **22.2 ms** and was not memoized — the second call cost
 * 19.4 ms. `buildChatAgent` on the headless path fired **two** (via `createSandboxBackend` and via
 * `resolveSandboxPosture`, which M70 added), totalling 46.4 ms per construction. Under `strace`, ~90%
 * of the 182 syscalls of a warm construction came from here.
 *
 * **Why no invalidation.** The milestone called for invalidating on `SessionStart`, but
 * `agents/lib/hooks/hooks.ts:28-30` documents — as a MEASURED correction of an earlier assumption — that
 * that event fires **once per TURN**. Invalidating there would re-probe every turn, that is, it would be
 * exactly the behavior this test exists to eliminate. The reference does not invalidate either:
 * its only cache is a write-once `OnceLock` (`linux-sandbox/src/launcher.rs:52`).
 *
 * The price, stated plainly: a `bwrap` installed AFTER the process starts is not detected until restart.
 */
describe("M71 T1.1 — per-process memoization", () => {
  it("test_detectBwrap_probes_exactly_once", () => {
    resetBwrapMemo();
    let probeCalls = 0;
    const probes = {
      which: () => {
        probeCalls++;
        return "/usr/bin/bwrap";
      },
      helpText: () => "--perms",
      userns: () => true,
    };
    // The memo applies to the REAL probes. With injected probes (test), every call probes — otherwise a
    // test would poison the process cache for every other one.
    detectBwrap(probes);
    detectBwrap(probes);
    expect(probeCalls, "injected probes must not be memoized").toBe(2);

    resetBwrapMemo();
    let realRuns = 0;
    const asIfReal = {
      which: () => {
        realRuns++;
        return null;
      },
      helpText: () => null,
      userns: () => false,
    };
    detectBwrapMemoized(asIfReal);
    detectBwrapMemoized(asIfReal);
    detectBwrapMemoized(asIfReal);
    expect(realRuns, "the memoized probe must run ONCE").toBe(1);
  });

  it("test_the_second_call_is_practically_free", () => {
    resetBwrapMemo();
    const probes = { which: () => "/usr/bin/bwrap", helpText: () => "--perms", userns: () => true };
    detectBwrapMemoized(probes);
    const t = performance.now();
    for (let i = 0; i < 100; i++) detectBwrapMemoized(probes);
    const ms = (performance.now() - t) / 100;
    expect(ms, `the second call cost ${ms.toFixed(3)}ms`).toBeLessThan(1);
  });

  it("test_the_memo_preserves_the_negative_result", () => {
    // Failing closed is a result too: a host WITHOUT bwrap must not re-probe every turn just because
    // the answer was "no".
    resetBwrapMemo();
    let n = 0;
    const withoutBwrap = {
      which: () => {
        n++;
        return null;
      },
      helpText: () => null,
      userns: () => false,
    };
    const a = detectBwrapMemoized(withoutBwrap);
    const b = detectBwrapMemoized(withoutBwrap);
    expect(a.ok).toBe(false);
    expect(b).toEqual(a);
    expect(n).toBe(1);
  });

  /**
   * Review F-perf-9 — the direction of stale memo the original m71-cost-per-turn#ADR-1 did not
   * declare, and the only one with a security consequence: the validated binary disappears from the
   * host AFTER detection.
   *
   * Without revalidation, the posture would keep asserting `enforced: true / "kernel (bwrap)"` for
   * the whole process and M70's veto would approve a gated tool citing a confinement that no longer
   * exists — the defect M70 fixed, reintroduced by M71's memoization.
   */
  it("test_the_memo_downgrades_the_positive_when_the_binary_leaves_the_host", () => {
    const dir = mkdtempSync(join(tmpdir(), "m71-bwrap-"));
    const bin = join(dir, "bwrap");
    writeFileSync(bin, "#!/bin/sh\n");
    resetBwrapMemo();
    const probes = { which: () => bin, helpText: () => "--perms", userns: () => true };

    expect(detectBwrapMemoized(probes)).toEqual({ ok: true, bin });

    rmSync(bin); // the operator removed/renamed bwrap mid-session

    const after = detectBwrapMemoized(probes);
    expect(after.ok, "the memo kept asserting kernel confinement without the binary").toBe(false);
    expect(after.ok === false && after.reason).toMatch(/disappeared/);
  });

  it("test_revalidation_does_not_re_probe", () => {
    // Revalidation is 1 syscall, not the 22.2 ms probe memoization exists to eliminate.
    const dir = mkdtempSync(join(tmpdir(), "m71-bwrap-"));
    const bin = join(dir, "bwrap");
    writeFileSync(bin, "#!/bin/sh\n");
    resetBwrapMemo();
    let n = 0;
    const probes = {
      which: () => {
        n++;
        return bin;
      },
      helpText: () => "--perms",
      userns: () => true,
    };
    for (let i = 0; i < 50; i++) detectBwrapMemoized(probes);
    expect(n, "revalidation turned into a re-probe — M71's gain is dead").toBe(1);
  });

  it("test_the_reset_exists_and_is_explicit", () => {
    resetBwrapMemo();
    let n = 0;
    const p = {
      which: () => {
        n++;
        return null;
      },
      helpText: () => null,
      userns: () => false,
    };
    detectBwrapMemoized(p);
    resetBwrapMemo();
    detectBwrapMemoized(p);
    expect(n, "the reset is the TEST seam — production never calls it").toBe(2);
  });
});
