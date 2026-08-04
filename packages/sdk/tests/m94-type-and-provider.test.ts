/**
 * M94 Phase 3 — the record's type and the model-id grammar.
 *
 * ## ADR-1: the new type is NOT called `SessionMessage`
 *
 * O ROADMAP pede "o SDK publica `SessionMessage { role; content: Array<…> }`". Medido:
 * `SessionMessage` **already exists** (`internal/session/session-types.ts:49`) and is `{role, text}` — an
 * **incompatible** shape. Reusing the name would make assignments fail silently for existing consumers:
 * exactly M91, where repurposing `BudgetExceededError` cost two patches. The new type is
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

  it("the existing SessionMessage stays intact — ADR-1 anti-regression", () => {
    const antigo: SessionMessage = { role: "assistant", text: "texto plano" };
    expect(antigo.text).toBe("texto plano");
  });
});

describe("M94 — Provider.forModel", () => {
  it("resolve o builtin pelo prefixo do id", () => {
    expect(Provider.forModel("anthropic/claude-sonnet-4-5")?.name).toBe("anthropic");
  });

  it("an id WITHOUT a slash returns undefined — today that silently became the default path", () => {
    // `modelId.slice(0, modelId.indexOf('/'))` with indexOf === -1 returns the id minus its LAST
    // caractere ('claude-opus-5' -> 'claude-opus-'), casa provider nenhum, e o consumidor
    // seguia para o default sem distinguir isso de um acerto.
    expect(Provider.forModel("claude-opus-5")).toBeUndefined();
  });

  it("a nonexistent provider returns undefined, not a partial match", () => {
    expect(Provider.forModel("naoexiste/algum-modelo")).toBeUndefined();
  });

  it("aliases and case resolve — the grammar has ONE owner", () => {
    // Measured in adversarial review: 7 of 8 divergences between the canonical parser and the inline slice.
    // `lm-studio` is an alias of `lmstudio`, which IS builtin; refusing it would make a custom command that
    // worked before M94 start THROWING, because the consumer now fails loudly.
    expect(Provider.forModel("Anthropic/claude-sonnet-4-5")?.name).toBe("anthropic");
    expect(Provider.forModel(" openai/gpt-4o")?.name).toBe("openai");
  });

  it("an empty model name is refused — the inline slice accepted it", () => {
    expect(Provider.forModel("openai/")).toBeUndefined();
  });

  it("a trailing slash does not become an empty provider", () => {
    expect(Provider.forModel("/modelo")).toBeUndefined();
  });
});
