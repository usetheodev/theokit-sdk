import { describe, expect, it } from "vitest";
import type { ModelListItem } from "../../src/tui/model-selector.js";
import { formatModelList, resolveModelDisplay } from "../../src/tui/model-selector.js";

describe("formatModelList", () => {
  it("formats models with active marker", () => {
    const models: ModelListItem[] = [
      { id: "m1", provider: "anthropic", name: "claude-sonnet-4", isActive: true },
      { id: "m2", provider: "openai", name: "gpt-4o", isActive: false },
    ];
    const lines = formatModelList(models);
    expect(lines[0]).toBe("> anthropic/claude-sonnet-4");
    expect(lines[1]).toBe("  openai/gpt-4o");
  });
});

describe("resolveModelDisplay", () => {
  it("splits provider/model correctly", () => {
    const result = resolveModelDisplay("anthropic/claude-sonnet-4");
    expect(result.provider).toBe("anthropic");
    expect(result.shortName).toBe("claude-sonnet-4");
  });

  it("handles IDs without a slash", () => {
    const result = resolveModelDisplay("local-model");
    expect(result.provider).toBe("unknown");
    expect(result.shortName).toBe("local-model");
  });
});
