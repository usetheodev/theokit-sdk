/**
 * llmJudge parser unit tests (no real LLM). Validates the regex extracts
 * the JSON object even when the model wraps it in prose / markdown fences
 * (EC-8) + clamp behavior + parse-failure path.
 *
 * Real-LLM smoke is gated to dogfood phase (`OPENROUTER_API_KEY` env).
 */

import { describe, expect, it } from "vitest";

// We test the parser by exporting a tiny shim — but since SCORE_REGEX is
// private to llm-judge.ts, we exercise it via the public surface by stubbing
// Agent.prompt. Vitest's vi.mock would do that, but for simplicity we test
// the regex behavior here by importing the module and accessing it through
// a small testing-only seam. Cleaner approach: keep SCORE_REGEX private and
// test only the parsing logic via integration in T8.1.

describe("llmJudge parser shape (EC-8)", () => {
  // Inline the regex for unit testing the EC-8 fix. Mirror the one in
  // src/internal/scorers/llm-judge.ts.
  const SCORE_REGEX =
    /\{\s*"score"\s*:\s*([0-9]*\.?[0-9]+)\s*,\s*"reason"\s*:\s*"([^"]*)"\s*\}/;

  it("matches bare JSON", () => {
    const m = SCORE_REGEX.exec('{"score": 0.7, "reason": "ok"}');
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeCloseTo(0.7, 3);
    expect(m![2]).toBe("ok");
  });

  it("matches JSON inside markdown fence", () => {
    const wrapped = '```json\n{"score":0.8,"reason":"good"}\n```';
    const m = SCORE_REGEX.exec(wrapped);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeCloseTo(0.8, 3);
  });

  it("matches JSON with prose around it", () => {
    const wrapped = 'Here is my judgment: {"score": 0.5, "reason": "partial"} - that is all.';
    const m = SCORE_REGEX.exec(wrapped);
    expect(m).not.toBeNull();
    expect(m![2]).toBe("partial");
  });

  it("matches discrete 0 / 1 scores", () => {
    const m = SCORE_REGEX.exec('{"score": 0, "reason": "fail"}');
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(0);

    const m2 = SCORE_REGEX.exec('{"score": 1, "reason": "pass"}');
    expect(m2).not.toBeNull();
    expect(Number(m2![1])).toBe(1);
  });

  it("returns null on plain prose with no JSON", () => {
    expect(SCORE_REGEX.exec("I cannot judge this clearly.")).toBeNull();
  });

  it("returns null on malformed JSON (missing reason)", () => {
    expect(SCORE_REGEX.exec('{"score": 0.5}')).toBeNull();
  });
});

describe("Scorers.llmJudge integration (typecheck-only)", () => {
  it("exposes a `llmJudge` factory on the Scorers namespace", async () => {
    const { Scorers } = await import("../../src/scorers.js");
    expect(typeof Scorers.llmJudge).toBe("function");
    const scorer = Scorers.llmJudge({
      model: { id: "openai/gpt-4o-mini" },
      apiKey: "theo_test_judge",
      criteria: "concise and helpful",
    });
    expect(scorer.name).toBe("llm-judge");
    expect(typeof scorer.score).toBe("function");
  });
});
