/**
 * M75 T3.2 — `interactiveWrapCommand`: the missing composition.
 *
 * ## Por que ela existe, e por que no SDK
 *
 * `createSandboxBackend` already does this composition for the **non-interactive** path: it detects bwrap,
 * decides between confining and degrading honestly, and returns a ready backend. The interactive path
 * (PTY) needs exactly the same decision, but delivered as a **wrap function** — because the PTY
 * owns the spawn and only accepts transforming the command (`PtyInteractiveBackend({ wrapCommand })`).
 *
 * Without this function, every consumer wanting a confined interactive shell would rewrite the same
 * sequence: `detectBwrapMemoized` -> `if (!ok) WARN-once` -> `wrapCommandForSandbox` with
 * `allowlistedEnv` e `restrictedSeccompPath`. Era o que o agent-builder fazia em 99 linhas de
 * subclass, and it is precisely what M75 exists to eliminate — "what every theokit consumer
 * que rode comandos vai reimplementar".
 *
 * ## O invariante que os testes protegem
 *
 * The two "do not confine" routes are **semantically different** and the code must not merge them:
 * `danger-full-access` is an explicit opt-out (no warning), while bwrap being unavailable is a
 * failure (warns, once). Both return `null` — the value is the same, the meaning is not.
 */
import { describe, expect, it } from "vitest";

import {
  type BwrapDetection,
  interactiveWrapCommand,
  resetInteractiveWarnLatch,
} from "../src/sandbox/index.js";

const detectaOk = (): BwrapDetection => ({ ok: true, bin: "/usr/bin/bwrap" });
const detectFailure = (): BwrapDetection => ({ ok: false, reason: "bwrap not found in PATH" });

describe("M75 T3.2 — interactiveWrapCommand", () => {
  it("test_confines_when_bwrap_exists", () => {
    const wrap = interactiveWrapCommand({ mode: "workspace-write", detect: detectaOk });
    const out = wrap("python3 -i", "/w");
    expect(out, "with bwrap available the command MUST be wrapped").not.toBeNull();
    expect(out).toContain("/usr/bin/bwrap");
    expect(out).toContain("--unshare-net");
    // The cwd received is what the PTY will use: the binds must target the SAME directory, otherwise
    // the confinement points one way and the process runs another.
    expect(out).toContain("/w");
  });

  it("test_danger_full_access_returns_null_and_does_NOT_warn", () => {
    resetInteractiveWarnLatch();
    const warnings: string[] = [];
    const wrap = interactiveWrapCommand({
      mode: "danger-full-access",
      detect: detectaOk,
      warn: (m) => warnings.push(m),
    });
    expect(wrap("bash", "/w")).toBeNull();
    // The distinction the code must not lose: "the user turned it off" is not an anomaly.
    expect(warnings, "an explicit opt-out is not an anomaly and must not warn").toHaveLength(0);
  });

  it("test_absent_bwrap_returns_null_and_warns_ONCE", () => {
    resetInteractiveWarnLatch();
    const warnings: string[] = [];
    const wrap = interactiveWrapCommand({
      mode: "workspace-write",
      detect: detectFailure,
      warn: (m) => warnings.push(m),
    });
    expect(wrap("bash", "/w")).toBeNull();
    expect(wrap("python3", "/w")).toBeNull();
    // Once per process: repeating it every interactive session becomes noise nobody reads.
    expect(warnings, "the warning repeated — it becomes noise and stops being read").toHaveLength(
      1,
    );
    expect(warnings[0], "the warning must say WHY and in which mode").toMatch(
      /PATH.*workspace-write/s,
    );
    expect(warnings[0], "the warning must make clear there is NO confinement").toMatch(
      /WITHOUT|sem confinamento|not confined/i,
    );
  });

  it("test_read_only_grants_no_write_even_on_the_cwd", () => {
    const out = interactiveWrapCommand({ mode: "read-only", detect: detectaOk })("bash", "/w");
    // `wrapCommandForSandbox` returns the SHELL-QUOTED string (each flag in single quotes), not the
    // raw argv. The first version of this test asserted the raw form — and the NEGATIVE assertion
    // passed vacuously: `not.toContain("--bind /w /w")` would be true even with the bind
    // present, because the real form is `'--bind' '/w' '/w'`. A test that cannot fail proves
    // nothing, and this was precisely the one protecting read-only mode.
    expect(out).toContain("'--ro-bind' '/' '/'");
    expect(out, "read-only must not write-bind the cwd").not.toContain("'--bind' '/w' '/w'");
  });

  it("test_a_lente_negativa_do_read_only_e_capaz_de_falhar", () => {
    // Proof the assertion above is NOT vacuous: in the mode that MUST write to the cwd, the same
    // the searched string does appear. Without this counter-proof, `not.toContain` would stay green forever.
    const rw = interactiveWrapCommand({ mode: "workspace-write", detect: detectaOk })("bash", "/w");
    expect(rw, "workspace-write MUST write-bind the cwd").toContain("'--bind' '/w' '/w'");
  });

  it("test_detection_is_consulted_per_wrap_not_frozen_at_construction", () => {
    // An interactive session lives for hours. Freezing detection at construction would mean that
    // installing bwrap mid-session would never take effect — and, worse, that a stale positive
    // detection would keep asserting confinement after the binary vanished.
    let calls = 0;
    const wrap = interactiveWrapCommand({
      mode: "workspace-write",
      detect: () => {
        calls++;
        return detectaOk();
      },
    });
    wrap("a", "/w");
    wrap("b", "/w");
    expect(calls, "detection was frozen at construction").toBe(2);
  });
});

/**
 * M75 review (architecture, MEDIUM) — the rule "seccomp only with a restricted network" had TWO copies.
 *
 * O construtor de `LinuxSandbox` decidia condicionalmente; `interactiveWrapCommand` instalava
 * unconditionally. They diverged in the very first version, and the effect is the worst possible combination: with
 * `network: true` o bwrap **permite** a rede (sem `--unshare-net`) e o seccomp a **nega** com EPERM.
 * The user asks for network, gets the bind, and the calls die with no explanation.
 *
 * This test locks both paths to the SAME decision. If anyone duplicates the rule again, it fails.
 */
describe("M75 review — seccomp e rede decidem juntos nos dois caminhos", () => {
  it("test_an_open_network_does_NOT_install_seccomp_interactively", () => {
    const out = interactiveWrapCommand({
      mode: "workspace-write",
      network: true,
      detect: detectaOk,
    })("bash", "/w");
    expect(out, "with the network open bwrap must not isolate it").not.toContain("--unshare-net");
    expect(
      out,
      "the cBPF filter denies network syscalls: installing it with the network open makes bwrap allow and " +
        "seccomp negar a MESMA coisa",
    ).not.toContain("--seccomp");
  });

  it("test_rede_restrita_instala_seccomp_no_interativo", () => {
    // COUNTER-PROOF: without it the `not.toContain` above would stay green even if seccomp were never
    // installed — and then the test would protect the filter's absence instead of the rule's coherence.
    const out = interactiveWrapCommand({
      mode: "workspace-write",
      network: false,
      detect: detectaOk,
    })("bash", "/w");
    expect(out).toContain("--unshare-net");
    expect(out, "com a rede fechada o filtro TEM de ser instalado").toContain("--seccomp");
  });
});
