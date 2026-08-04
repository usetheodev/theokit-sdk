/**
 * M94 Fase 3 — o tipo do registro e a gramática do id de modelo.
 *
 * ## ADR-1: o tipo novo NÃO se chama `SessionMessage`
 *
 * O ROADMAP pede "o SDK publica `SessionMessage { role; content: Array<…> }`". Medido:
 * `SessionMessage` **já existe** (`internal/session/session-types.ts:49`) e é `{role, text}` — forma
 * **incompatível**. Reusar o nome faria atribuições falharem em silêncio para quem já o consome:
 * exatamente o M91, onde repropor `BudgetExceededError` custou dois patches. O tipo novo é
 * `TranscriptMessage`.
 */
import { describe, expect, it } from "vitest";
import { Provider } from "../src/define-provider.js";
import type { SessionMessage } from "../src/internal/session/session-types.js";
import type { TranscriptMessage } from "../src/types/session-record.js";

describe("M94 — TranscriptMessage", () => {
  it("descreve a forma que o escritor de fato grava", () => {
    const m: TranscriptMessage = {
      role: "user",
      content: [
        { type: "text", text: "oi" },
        { type: "tool_result", tool_use_id: "t1", content: "saida", is_error: false },
      ],
    };
    expect(m.content).toHaveLength(2);
    expect(m.content[0]?.type).toBe("text");
  });

  it("o SessionMessage existente segue intacto — anti-regressão do ADR-1", () => {
    const antigo: SessionMessage = { role: "assistant", text: "texto plano" };
    expect(antigo.text).toBe("texto plano");
  });
});

describe("M94 — Provider.forModel", () => {
  it("resolve o builtin pelo prefixo do id", () => {
    expect(Provider.forModel("anthropic/claude-sonnet-4-5")?.name).toBe("anthropic");
  });

  it("um id SEM barra devolve undefined — hoje isso virava o caminho default em silêncio", () => {
    // `modelId.slice(0, modelId.indexOf('/'))` com indexOf === -1 devolve o id sem o ÚLTIMO
    // caractere ('claude-opus-5' -> 'claude-opus-'), casa provider nenhum, e o consumidor
    // seguia para o default sem distinguir isso de um acerto.
    expect(Provider.forModel("claude-opus-5")).toBeUndefined();
  });

  it("um provider inexistente devolve undefined, não um casamento parcial", () => {
    expect(Provider.forModel("naoexiste/algum-modelo")).toBeUndefined();
  });

  it("aliases e caixa resolvem — a gramática tem UM dono", () => {
    // Medido na revisão adversarial: 7 de 8 divergências entre o parser canônico e o slice inline.
    // `lm-studio` é alias de `lmstudio`, que É builtin; recusá-lo faria um comando customizado que
    // funcionava antes do M94 passar a LANÇAR, porque o consumidor agora falha alto.
    expect(Provider.forModel("Anthropic/claude-sonnet-4-5")?.name).toBe("anthropic");
    expect(Provider.forModel(" openai/gpt-4o")?.name).toBe("openai");
  });

  it("nome de modelo vazio é recusado — o slice inline aceitava", () => {
    expect(Provider.forModel("openai/")).toBeUndefined();
  });

  it("a barra final não vira provider vazio", () => {
    expect(Provider.forModel("/modelo")).toBeUndefined();
  });
});
