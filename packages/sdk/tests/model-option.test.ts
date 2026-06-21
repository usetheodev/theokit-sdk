import { describe, expect, it } from "vitest";

import { humanizeModelName, toModelOption } from "../src/internal/llm/model-option.js";

describe("humanizeModelName (M5-8)", () => {
  it("humanizes an OpenRouter routed slug with a variant", () => {
    expect(humanizeModelName("openrouter/openai/gpt-4o:free")).toBe("GPT 4o (free)");
  });

  it("humanizes a vendor/model slug", () => {
    expect(humanizeModelName("anthropic/claude-3-5-sonnet")).toBe("Claude 3 5 Sonnet");
  });

  it("humanizes a plain (no-prefix) slug", () => {
    expect(humanizeModelName("claude-sonnet-4-6")).toBe("Claude Sonnet 4 6");
  });

  it("returns empty string for empty input", () => {
    expect(humanizeModelName("")).toBe("");
  });

  it("keeps the model name when the slug has a trailing slash (no empty label)", () => {
    expect(humanizeModelName("gpt-4o/")).toBe("GPT 4o");
  });

  it("degrades to the bare variant when there is no base label", () => {
    expect(humanizeModelName(":free")).toBe("free");
    expect(humanizeModelName("anthropic/:free")).toBe("free");
  });

  it("(EC-1) keeps the full variant tail when the slug has multiple colons", () => {
    expect(humanizeModelName("openrouter/x/y:free:beta")).toBe("Y (free:beta)");
  });

  it("(EC-2) uppercases known acronyms, leaves numeric tokens, title-cases the rest", () => {
    expect(humanizeModelName("openai/gpt-4o")).toBe("GPT 4o");
    expect(humanizeModelName("mistral/sonnet")).toBe("Sonnet");
  });
});

describe("toModelOption (M5-8)", () => {
  it("builds { value, label, provider }", () => {
    expect(toModelOption("openrouter/openai/gpt-4o:free")).toEqual({
      value: "openrouter/openai/gpt-4o:free",
      label: "GPT 4o (free)",
      provider: "openrouter",
    });
  });

  it("provider is undefined for a no-prefix slug", () => {
    expect(toModelOption("claude-sonnet-4-6")).toEqual({
      value: "claude-sonnet-4-6",
      label: "Claude Sonnet 4 6",
      provider: undefined,
    });
  });
});
