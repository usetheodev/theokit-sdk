/**
 * M75 T2.2 — `LinuxSandbox` + the wrap + the posture, promoted from agent-builder.
 *
 * ## Why it fits the contract without breaking it
 *
 * `SandboxBackend` declares exactly 2 abstracts (`execute`, `uploadFile`); `readFile`/`writeFile`/
 * `glob`/`grep` are concrete over `execute`. `LinuxSandbox` only does `override execute` — the method
 * **already abstract** — and **adds** `wrapCommand`. No member is missing, so promoting forces no major.
 *
 * ## What these tests protect, which is not obvious
 *
 * This subsystem's value is not in confining when things go right — it is in **NEVER pretending**
 * when they go wrong. Three honest-degradation paths are tested here as negative cases, asserting
 * the specific error/warning rather than "it did not throw": bwrap absent, `danger-full-access` (an
 * explicit opt-out, which is NOT an anomaly and therefore does not warn), and a non-x86_64
 * architecture (where the cBPF filter would kill every syscall).
 */
import { describe, expect, it } from "vitest";

import {
  allowlistedEnv,
  type BwrapDetection,
  createSandboxBackend,
  LinuxSandbox,
  resolveSandboxPosture,
  SandboxBackend,
  seccompPathForArch,
  wrapCommandForSandbox,
} from "../src/sandbox/index.js";
// By explicit module path, not through the barrel: these are test seams and the package keeps them
// out of its public surface (see the note at the foot of src/sandbox/index.ts).
import { __resetSandboxWarnLatchForTests } from "../src/sandbox/linux-sandbox.js";

const detectOk = (): BwrapDetection => ({ ok: true, bin: "/usr/bin/bwrap" });
const detectFailure = (): BwrapDetection => ({ ok: false, reason: "bwrap not found in PATH" });

describe("M75 T2.2 — wrapCommandForSandbox", () => {
  it("test_it_wraps_with_bwrap_and_preserves_the_quoted_command", () => {
    const w = wrapCommandForSandbox(
      "workspace-write",
      { cwd: "/w", network: false, env: {}, bin: "/usr/bin/bwrap" },
      "echo 'oi'",
    );
    expect(w).not.toBeNull();
    // The command crosses ONE extra `/bin/sh -c`: the quoting must survive, otherwise a command with
    // single quotes would become a different command inside the sandbox.
    expect(w).toContain("/bin/sh -c");
    expect(w).toContain("--unshare-net");
  });

  it("test_danger_full_access_returns_null", () => {
    // `null` = "do not wrap". Returning the raw command would conflate the two in the caller.
    expect(
      wrapCommandForSandbox("danger-full-access", { cwd: "/w", env: {} }, "echo oi"),
    ).toBeNull();
  });

  it("test_seccomp_only_goes_in_when_there_is_a_path", () => {
    const sem = wrapCommandForSandbox("workspace-write", { cwd: "/w", env: {} }, "true");
    const com = wrapCommandForSandbox(
      "workspace-write",
      { cwd: "/w", env: {}, seccompPath: "/tmp/f.bpf" },
      "true",
    );
    expect(sem).not.toContain("--seccomp");
    // The program comes in via an fd 3 redirect — that is how bwrap reads it.
    expect(com).toContain("--seccomp");
    expect(com).toContain("3< ");
  });
});

describe("M75 T2.2 — allowlistedEnv", () => {
  it("test_reinjects_only_what_is_allowed_and_discards_the_rest", () => {
    // Codex's env_clear model: the child gets what it needs to run a shell, never the parent's env
    // — which may hold a secret under a name no name-based heuristic catches.
    const env = allowlistedEnv({ PATH: "/bin", MY_ODDLY_NAMED_KEY: "s3cr3t", HOME: "/h" });
    expect(env).toEqual({ PATH: "/bin", HOME: "/h" });
    expect(Object.values(env)).not.toContain("s3cr3t");
  });
});

describe("M75 T2.2 — LinuxSandbox", () => {
  it("test_it_is_a_sandbox_backend_of_the_contract", () => {
    const s = new LinuxSandbox(
      { workDir: "/w" },
      { mode: "workspace-write", bin: "/usr/bin/bwrap" },
    );
    expect(s).toBeInstanceOf(SandboxBackend);
  });

  it("test_the_objects_wrap_command_uses_the_mode_it_was_built_with", () => {
    const s = new LinuxSandbox(
      { workDir: "/w" },
      { mode: "workspace-write", bin: "/usr/bin/bwrap" },
    );
    expect(s.wrapCommand("true")).toContain("--unshare-net");

    const livre = new LinuxSandbox({ workDir: "/w" }, { mode: "danger-full-access" });
    expect(livre.wrapCommand("true")).toBeNull();
  });
});

describe("M75 T2.2 — honest degradation (negative cases)", () => {
  it("test_absent_bwrap_warns_ONCE_and_returns_an_unconfined_backend", () => {
    __resetSandboxWarnLatchForTests();
    const warnings: string[] = [];
    const opts = {
      mode: "workspace-write" as const,
      detect: detectFailure,
      warn: (m: string) => warnings.push(m),
    };
    const a = createSandboxBackend(opts);
    const b = createSandboxBackend(opts);

    expect(a).toBeInstanceOf(SandboxBackend);
    expect(b).toBeInstanceOf(SandboxBackend);
    // Neither is a LinuxSandbox: without bwrap there is no confinement, and pretending would be the worst outcome.
    expect(a).not.toBeInstanceOf(LinuxSandbox);
    // ONCE: the warning is for the human, and repeating it on every tool call becomes noise nobody reads.
    expect(warnings, "the warning repeated — it becomes noise and stops being read").toHaveLength(
      1,
    );
    expect(warnings[0], "the warning must say WHY and in which mode").toMatch(
      /PATH.*workspace-write/s,
    );
  });

  it("test_danger_full_access_does_not_warn_because_it_is_an_explicit_opt_out", () => {
    __resetSandboxWarnLatchForTests();
    const warnings: string[] = [];
    const s = createSandboxBackend({
      mode: "danger-full-access",
      detect: detectFailure,
      warn: (m: string) => warnings.push(m),
    });
    expect(s).not.toBeInstanceOf(LinuxSandbox);
    // The distinction that matters: "the user turned it off" is not an anomaly; "I could not turn it on" is.
    expect(warnings, "an explicit opt-out is not an anomaly and must not warn").toHaveLength(0);
  });

  it("test_a_non_x64_architecture_refuses_seccomp_and_warns", () => {
    // ARCH GUARD: the cBPF program is x86_64 and its guard KILLS every syscall from another
    // architecture — the first execve would die, and silently, because generation works and bwrap
    // accepts it.
    const warnings: string[] = [];
    const p = seccompPathForArch("arm64", (m) => warnings.push(m));
    expect(p, "on arm64 no seccomp path may be returned").toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/x86_64|x64/i);
  });
});

describe("M75 T2.2 — resolveSandboxPosture", () => {
  it("test_confined_reports_kernel", () => {
    const p = resolveSandboxPosture({ mode: "workspace-write", detect: detectOk });
    expect(p.enforced).toBe(true);
    expect(p.detail).toMatch(/kernel/i);
  });

  it("test_without_bwrap_it_says_not_confined_WITH_the_reason", () => {
    // The posture is what the UI shows. "not confined" without a reason leaves the user with no action; with the
    // reason they know whether to install bwrap or whether they changed mode.
    const p = resolveSandboxPosture({ mode: "workspace-write", detect: detectFailure });
    expect(p.enforced).toBe(false);
    expect(p.detail).toContain("PATH");
  });

  it("test_danger_full_access_is_honestly_not_confined", () => {
    const p = resolveSandboxPosture({ mode: "danger-full-access", detect: detectOk });
    expect(p.enforced, "danger-full-access may never report confinement").toBe(false);
  });
});
