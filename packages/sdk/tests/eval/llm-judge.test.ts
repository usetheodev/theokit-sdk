/**
 * `parseScore` — the judge's reply parser, tested against the production function.
 *
 * IT USED TO TEST A COPY. This file declared its own `SCORE_REGEX` under the comment "Mirror the one
 * in src/internal/scorers/llm-judge.ts", and six of its eight cases exercised that copy. It was
 * byte-identical, which is the best case and also why the drift would have been invisible: changing
 * the production regex broke nothing here. The file named its own compromise and proposed the fix as
 * a deferral with no owner and no date.
 *
 * The cases below call `_parseScoreForTests`, the seam this repo already uses elsewhere for exactly
 * this (`_redactAttrValueForTests`, `__resetSnapshotStoresForTests`). Testing through the parser
 * rather than the regex also reaches what a regex test structurally cannot: the clamp, the discrete
 * rounding, the non-finite guard, and the two named parse-failure reasons — all of which the old
 * docblock claimed to validate and none of which it touched.
 *
 * Real-LLM smoke is gated to dogfood phase (`OPENROUTER_API_KEY` env).
 */

import { describe, expect, it } from "vitest";

import { _parseScoreForTests } from "../../src/internal/scorers/llm-judge.js";
import { Scorers } from "../../src/scorers.js";

const parse = (text: string, rubric: "continuous" | "discrete" = "continuous") =>
  _parseScoreForTests(text, rubric);

describe("llmJudge parser (EC-8)", () => {
  it("reads a bare JSON reply", () => {
    expect(parse('{"score": 0.7, "reason": "ok"}')).toEqual({ score: 0.7, reason: "ok" });
  });

  it("reads JSON inside a markdown fence", () => {
    expect(parse('```json\n{"score":0.8,"reason":"good"}\n```')).toEqual({
      score: 0.8,
      reason: "good",
    });
  });

  it("reads JSON with prose around it", () => {
    expect(
      parse('Here is my judgment: {"score": 0.5, "reason": "partial"} - that is all.'),
    ).toEqual({
      score: 0.5,
      reason: "partial",
    });
  });

  it("reads discrete 0 / 1 scores", () => {
    expect(parse('{"score": 0, "reason": "fail"}')).toEqual({ score: 0, reason: "fail" });
    expect(parse('{"score": 1, "reason": "pass"}')).toEqual({ score: 1, reason: "pass" });
  });

  it("reports judge_parse_failed on prose with no JSON", () => {
    // The regex returning null was all the old test could see. What a CALLER gets is a Score with a
    // named reason and a zero, and that is the contract the run depends on.
    expect(parse("I cannot judge this clearly.")).toEqual({
      score: 0,
      reason: "judge_parse_failed",
    });
  });

  it("reports judge_parse_failed on malformed JSON (missing reason)", () => {
    expect(parse('{"score": 0.5}')).toEqual({ score: 0, reason: "judge_parse_failed" });
  });

  it("clamps a continuous score into [0, 1]", () => {
    // Untested before: the regex matches these happily and the clamp is what makes them safe.
    expect(parse('{"score": 1.5, "reason": "over"}')).toEqual({ score: 1, reason: "over" });
    expect(parse('{"score": 0.0, "reason": "floor"}')).toEqual({ score: 0, reason: "floor" });
  });

  it("rounds to 0 or 1 under the discrete rubric, at the 0.5 boundary", () => {
    // Untested before, and the boundary is where a rounding rule is worth stating.
    expect(parse('{"score": 0.5, "reason": "edge"}', "discrete")).toEqual({
      score: 1,
      reason: "edge",
    });
    expect(parse('{"score": 0.49, "reason": "below"}', "discrete")).toEqual({
      score: 0,
      reason: "below",
    });
  });

  it("keeps the reason verbatim, including an empty one", () => {
    expect(parse('{"score": 0.3, "reason": ""}')).toEqual({ score: 0.3, reason: "" });
  });
});

describe("Scorers.llmJudge integration (typecheck-only)", () => {
  it("exposes a `llmJudge` factory on the Scorers namespace", () => {
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
