/**
 * M94 Phase 3 — the record's type and the model-id grammar.
 *
 * ## ADR-1: the new type is NOT called `SessionMessage`
 *
 * The ROADMAP asks for "the SDK publishes `SessionMessage { role; content: Array<…> }`". Measured:
 * `SessionMessage` **already exists** (`internal/session/session-types.ts:49`) and is `{role, text}` — an
 * **incompatible** shape. Reusing the name would make assignments fail silently for existing consumers:
 * exactly M91, where repurposing `BudgetExceededError` cost two patches. The new type is
 * `TranscriptMessage`.
 */
import { describe, expect, it } from "vitest";
import { Provider } from "../src/define-provider.js";
import type { SessionMessage } from "../src/internal/session/types.js";
import type { TranscriptMessage } from "../src/types/session-record.js";

describe("M94 — TranscriptMessage", () => {
  it("describes the shape the writer actually writes", () => {
    const m: TranscriptMessage = {
      role: "user",
      content: [
        { type: "text", text: "oi" },
        { type: "tool_result", tool_use_id: "t1", content: "output", is_error: false },
      ],
    };
    expect(m.content).toHaveLength(2);
    expect(m.content[0]?.type).toBe("text");
  });

  it("the existing SessionMessage stays intact — ADR-1 anti-regression", () => {
    const legacy: SessionMessage = { role: "assistant", text: "plain text" };
    expect(legacy.text).toBe("plain text");
  });
});

describe("M94 — Provider.forModel", () => {
  it("resolves the builtin by the id prefix", () => {
    expect(Provider.forModel("anthropic/claude-sonnet-4-5")?.name).toBe("anthropic");
  });

  it("an id WITHOUT a slash returns undefined — today that silently became the default path", () => {
    // `modelId.slice(0, modelId.indexOf('/'))` with indexOf === -1 returns the id minus its LAST
    // character ('claude-opus-5' -> 'claude-opus-'), matches no provider, and the consumer
    // fell through to the default without distinguishing that from a hit.
    expect(Provider.forModel("claude-opus-5")).toBeUndefined();
  });

  it("a nonexistent provider returns undefined, not a partial match", () => {
    expect(Provider.forModel("nonexistent/some-model")).toBeUndefined();
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
    expect(Provider.forModel("/model")).toBeUndefined();
  });
});
