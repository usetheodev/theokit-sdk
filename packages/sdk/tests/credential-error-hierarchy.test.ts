/**
 * M78 T1.1 — `CredentialError` entra na hierarquia tipada do SDK.
 *
 * ## A cadeia causal que este teste fecha
 *
 * `isTransientError` é `err instanceof TheokitAgentError && err.isRetryable === true`
 * (`src/errors.ts:443`). `CredentialError` estendia `Error` NU
 * (`src/internal/auth/credential-store.ts:58`), então **nenhum erro de credencial podia jamais ser
 * classificado** — nem como transiente, nem como permanente. O predicado não estava "esquecido" pelo
 * consumidor: ele era inútil ali por construção.
 *
 * ## Por que no SDK, e não no consumidor
 *
 * O agent-builder importa `CredentialError` da camada desde o M73
 * (`agents/lib/auth/credentials.ts:90`) — ele não é dono da classe e não pode reparentá-la. A DoD do
 * ROADMAP formula isso como trabalho no consumidor; a medição mostrou que não é.
 *
 * ## O que a referência única faz
 *
 * O Codex tem UMA enum raiz — `CodexErr` (`protocol/src/error.rs:176`) — com `is_retryable()` como
 * método que enumera por variante. Não há classes paralelas estendendo o `Error` da linguagem. Esta é
 * a nossa versão disso.
 *
 * ## A metade que mais importa é a de preservação
 *
 * Reparentar é ADITIVO: `CredentialError` continua sendo `CredentialError`, e o `instanceof` que já
 * existe no consumidor (`agents/lib/auth/login.ts:48`) segue verdadeiro. Um teste que só provasse o
 * ancestral novo passaria mesmo se a classe tivesse sido substituída por outra.
 */
import { describe, expect, it } from "vitest";

import { AuthenticationError, isTransientError, TheokitAgentError } from "../src/errors.js";
import { CredentialError } from "../src/internal/auth/credential-store.js";

describe("M78 T1.1 — CredentialError na hierarquia tipada", () => {
  it("test_CredentialError_e_um_TheokitAgentError", () => {
    // Dois níveis acima: CredentialError -> AuthenticationError -> TheokitAgentError.
    const err = new CredentialError("chave ausente");
    expect(err).toBeInstanceOf(TheokitAgentError);
    expect(err).toBeInstanceOf(AuthenticationError);
  });

  it("test_CredentialError_continua_sendo_ELA_MESMA", () => {
    // A metade de preservação. Sem esta, trocar a classe inteira por `AuthenticationError` passaria
    // no teste acima e quebraria `login.ts:48` em silêncio.
    const err = new CredentialError("chave ausente");
    expect(err).toBeInstanceOf(CredentialError);
    expect(err.name).toBe("CredentialError");
    expect(err.message).toBe("chave ausente");
  });

  it("test_CONTRAPROVA_reparentar_NAO_tornou_o_erro_transiente", () => {
    // Reparentar dá acesso à classificação; não pode LIGAR retry por acidente. Uma credencial
    // revogada repetida em loop é pior que uma falha imediata — `AuthenticationError` já fixa
    // `isRetryable: false` (`errors.ts:181`), e este teste trava isso.
    expect(isTransientError(new CredentialError("revogada"))).toBe(false);
  });

  it("test_um_catch_generico_discrimina_framework_de_app_com_UM_instanceof", () => {
    // A DoD 5 do milestone, provada onde ela nasce. Antes, um `catch` recebia `Error` nu vindo do
    // store e `Error` nu vindo do app, sem forma de distinguir sem comparar strings de `name`.
    const doFramework: unknown = new CredentialError("do store");
    const doApp: unknown = new Error("do app");

    expect(doFramework instanceof TheokitAgentError).toBe(true);
    expect(doApp instanceof TheokitAgentError).toBe(false);
  });
});
