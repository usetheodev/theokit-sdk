/**
 * M75 T3.2 — `interactiveWrapCommand`: a composição que faltava.
 *
 * ## Por que ela existe, e por que no SDK
 *
 * `createSandboxBackend` já faz esta composição para o caminho **não-interativo**: detecta o bwrap,
 * decide entre confinar e degradar honestamente, e devolve um backend pronto. O caminho interativo
 * (PTY) precisa exatamente da mesma decisão, mas entregue como **função de wrap** — porque o PTY é
 * dono do spawn e só aceita transformar o comando (`PtyInteractiveBackend({ wrapCommand })`).
 *
 * Sem esta função, todo consumidor que quisesse shell interativo confinado reescreveria a mesma
 * sequência: `detectBwrapMemoizado` → `if (!ok) WARN-once` → `wrapCommandForSandbox` com
 * `allowlistedEnv` e `restrictedSeccompPath`. Era o que o agent-builder fazia em 99 linhas de
 * subclasse, e é precisamente o que o M75 existe para eliminar — "o que todo consumidor do theokit
 * que rode comandos vai reimplementar".
 *
 * ## O invariante que os testes protegem
 *
 * As duas rotas de "não confinar" são **semanticamente diferentes** e o código não pode fundi-las:
 * `danger-full-access` é opt-out explícito (não avisa), enquanto bwrap indisponível é uma falha
 * (avisa, uma vez). Ambas devolvem `null` — o valor é o mesmo, o significado não.
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
    expect(out, "com bwrap disponível o comando TEM de ser embrulhado").not.toBeNull();
    expect(out).toContain("/usr/bin/bwrap");
    expect(out).toContain("--unshare-net");
    // O cwd recebido é o que o PTY vai usar: os binds precisam mirar o MESMO diretório, senão o
    // confinamento aponta para um lugar e o processo roda em outro.
    expect(out).toContain("/w");
  });

  it("test_danger_full_access_devolve_null_e_NAO_avisa", () => {
    resetInteractiveWarnLatch();
    const avisos: string[] = [];
    const wrap = interactiveWrapCommand({
      mode: "danger-full-access",
      detect: detectaOk,
      warn: (m) => avisos.push(m),
    });
    expect(wrap("bash", "/w")).toBeNull();
    // A distinção que o código não pode perder: "o usuário desligou" não é anomalia.
    expect(avisos, "opt-out explícito não é anomalia e não deve avisar").toHaveLength(0);
  });

  it("test_bwrap_ausente_devolve_null_e_avisa_UMA_vez", () => {
    resetInteractiveWarnLatch();
    const avisos: string[] = [];
    const wrap = interactiveWrapCommand({
      mode: "workspace-write",
      detect: detectaFalha,
      warn: (m) => avisos.push(m),
    });
    expect(wrap("bash", "/w")).toBeNull();
    expect(wrap("python3", "/w")).toBeNull();
    // Uma vez por processo: repetir a cada sessão interativa vira ruído que ninguém lê.
    expect(avisos, "o aviso repetiu — vira ruído e deixa de ser lido").toHaveLength(1);
    expect(avisos[0], "o aviso precisa dizer POR QUE e em que modo").toMatch(
      /PATH.*workspace-write/s,
    );
    expect(avisos[0], "o aviso precisa deixar claro que NÃO há confinamento").toMatch(
      /WITHOUT|sem confinamento|not confined/i,
    );
  });

  it("test_read_only_nao_da_escrita_nem_no_cwd", () => {
    const out = interactiveWrapCommand({ mode: "read-only", detect: detectaOk })("bash", "/w");
    // `wrapCommandForSandbox` devolve a string SHELL-QUOTED (cada flag entre aspas simples), não o
    // argv cru. A primeira versão deste teste asseverava a forma crua — e a asserção NEGATIVA
    // passava por vacuidade: `not.toContain("--bind /w /w")` seria verdadeira mesmo com o bind
    // presente, porque a forma real é `'--bind' '/w' '/w'`. Um teste que não pode falhar não prova
    // nada, e este era justamente o que protege o modo somente-leitura.
    expect(out).toContain("'--ro-bind' '/' '/'");
    expect(out, "read-only não pode dar bind de escrita no cwd").not.toContain(
      "'--bind' '/w' '/w'",
    );
  });

  it("test_a_lente_negativa_do_read_only_e_capaz_de_falhar", () => {
    // Prova de que a asserção acima NÃO é vácua: no modo que DEVE dar escrita no cwd, a mesma
    // string procurada aparece. Sem esta contraprova, `not.toContain` continuaria verde para sempre.
    const rw = interactiveWrapCommand({ mode: "workspace-write", detect: detectaOk })("bash", "/w");
    expect(rw, "workspace-write TEM de dar bind de escrita no cwd").toContain("'--bind' '/w' '/w'");
  });

  it("test_a_deteccao_e_consultada_por_wrap_nao_congelada_na_construcao", () => {
    // Uma sessão interativa vive por horas. Congelar a detecção na construção significaria que
    // instalar o bwrap no meio da sessão nunca passaria a valer — e, pior, que uma detecção positiva
    // obsoleta continuaria afirmando confinamento depois de o binário sumir.
    let chamadas = 0;
    const wrap = interactiveWrapCommand({
      mode: "workspace-write",
      detect: () => {
        chamadas++;
        return detectaOk();
      },
    });
    wrap("a", "/w");
    wrap("b", "/w");
    expect(chamadas, "a detecção foi congelada na construção").toBe(2);
  });
});
