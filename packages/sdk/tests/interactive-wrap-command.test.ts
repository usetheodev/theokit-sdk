/**
 * M75 T3.2 — `interactiveWrapCommand`: the missing composition.
 *
 * ## Por que ela existe, e por que no SDK
 *
 * `createSandboxBackend` already does this composition for the **non-interactive** path: it detects bwrap,
 * decide entre confinar e degradar honestamente, e devolve um backend pronto. O caminho interativo
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
const detectaFalha = (): BwrapDetection => ({ ok: false, reason: "bwrap not found in PATH" });

describe("M75 T3.2 — interactiveWrapCommand", () => {
  it("test_confina_quando_bwrap_existe", () => {
    const wrap = interactiveWrapCommand({ mode: "workspace-write", detect: detectaOk });
    const out = wrap("python3 -i", "/w");
    expect(out, "with bwrap available the command MUST be wrapped").not.toBeNull();
    expect(out).toContain("/usr/bin/bwrap");
    expect(out).toContain("--unshare-net");
    // The cwd received is what the PTY will use: the binds must target the SAME directory, otherwise
    // confinamento aponta para um lugar e o processo roda em outro.
    expect(out).toContain("/w");
  });

  it("test_danger_full_access_devolve_null_e_NAO_avisa", () => {
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

  it("test_bwrap_ausente_devolve_null_e_avisa_UMA_vez", () => {
    resetInteractiveWarnLatch();
    const warnings: string[] = [];
    const wrap = interactiveWrapCommand({
      mode: "workspace-write",
      detect: detectaFalha,
      warn: (m) => warnings.push(m),
    });
    expect(wrap("bash", "/w")).toBeNull();
    expect(wrap("python3", "/w")).toBeNull();
    // Once per process: repeating it every interactive session becomes noise nobody reads.
    expect(warnings, "the warning repeated — it becomes noise and stops being read").toHaveLength(
      1,
    );
    expect(warnings[0], "o aviso precisa dizer POR QUE e em que modo").toMatch(
      /PATH.*workspace-write/s,
    );
    expect(warnings[0], "the warning must make clear there is NO confinement").toMatch(
      /WITHOUT|sem confinamento|not confined/i,
    );
  });

  it("test_read_only_nao_da_escrita_nem_no_cwd", () => {
    const out = interactiveWrapCommand({ mode: "read-only", detect: detectaOk })("bash", "/w");
    // `wrapCommandForSandbox` returns the SHELL-QUOTED string (each flag in single quotes), not the
    // raw argv. The first version of this test asserted the raw form — and the NEGATIVE assertion
    // passava por vacuidade: `not.toContain("--bind /w /w")` seria verdadeira mesmo com o bind
    // present, because the real form is `'--bind' '/w' '/w'`. A test that cannot fail proves
    // nada, e este era justamente o que protege o modo somente-leitura.
    expect(out).toContain("'--ro-bind' '/' '/'");
    expect(out, "read-only must not write-bind the cwd").not.toContain("'--bind' '/w' '/w'");
  });

  it("test_a_lente_negativa_do_read_only_e_capaz_de_falhar", () => {
    // Proof the assertion above is NOT vacuous: in the mode that MUST write to the cwd, the same
    // string procurada aparece. Sem esta contraprova, `not.toContain` continuaria verde para sempre.
    const rw = interactiveWrapCommand({ mode: "workspace-write", detect: detectaOk })("bash", "/w");
    expect(rw, "workspace-write TEM de dar bind de escrita no cwd").toContain("'--bind' '/w' '/w'");
  });

  it("test_a_deteccao_e_consultada_por_wrap_nao_congelada_na_construcao", () => {
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
  it("test_rede_liberada_NAO_instala_seccomp_no_interativo", () => {
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
    // CONTRAPROVA: sem ela o `not.toContain` acima ficaria verde mesmo se o seccomp nunca fosse
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
