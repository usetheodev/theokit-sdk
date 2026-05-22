/**
 * Built-in scorers for `Eval.create` (Adoption Roadmap #2, ADR D203).
 *
 * Each scorer is a CURRIED FACTORY: call with config, get back a
 * `NamedScorer` ready to drop into `EvalOptions.scorers[]`.
 *
 *   import { Scorers } from "@usetheo/sdk";
 *   const scorers = [
 *     Scorers.containsExpected({ caseSensitive: false }),
 *     Scorers.regex(/jazz|blues/i),
 *   ];
 *
 * @public
 */

import type { z, ZodType } from "zod";

import {
  llmJudgeScore,
  type LlmJudgeOptions,
} from "./internal/scorers/llm-judge.js";
import type { NamedScorer, Score } from "./types/eval.js";

/** EC-2 fix: cap JSON parse input to bound memory. 1 MB is generous for structured output. */
const JSON_SHAPE_MAX_BYTES = 1_000_000;

interface ExactMatchOptions {
  /** Case-sensitive compare. Default: true. */
  caseSensitive?: boolean;
}

interface ContainsExpectedOptions {
  /** Case-sensitive compare. Default: false. */
  caseSensitive?: boolean;
}

interface JsonShapeOptions {
  /** Include Zod's error message in the failure reason. Default: false. */
  strict?: boolean;
}

export const Scorers = {
  /**
   * `output.trim() === expected.trim()`. Refuses empty `expected` (EC-1
   * — two empties would otherwise pass silently).
   */
  exactMatch(opts: ExactMatchOptions = {}): NamedScorer {
    const cs = opts.caseSensitive ?? true;
    return {
      name: "exact-match",
      score: (output, expected): Score => {
        if (typeof expected !== "string") return { score: 0, reason: "expected_not_string" };
        if (expected.length === 0) return { score: 0, reason: "expected_empty" };
        const o = cs ? output : output.toLowerCase();
        const e = cs ? expected : expected.toLowerCase();
        const ok = o.trim() === e.trim();
        return ok ? { score: 1 } : { score: 0, reason: "mismatch" };
      },
    };
  },

  /**
   * `output.includes(expected)`. Refuses empty `expected` (EC-1 —
   * `"".includes("")` is always `true`, would inflate pass ratio).
   */
  containsExpected(opts: ContainsExpectedOptions = {}): NamedScorer {
    const cs = opts.caseSensitive ?? false;
    return {
      name: "contains-expected",
      score: (output, expected): Score => {
        if (typeof expected !== "string") return { score: 0, reason: "expected_not_string" };
        if (expected.length === 0) return { score: 0, reason: "expected_empty" };
        const o = cs ? output : output.toLowerCase();
        const e = cs ? expected : expected.toLowerCase();
        return o.includes(e) ? { score: 1 } : { score: 0, reason: "not_found" };
      },
    };
  },

  /**
   * `pattern.test(output)`.
   *
   * **ReDoS caveat (EC-10):** the regex is applied to LLM output, which
   * may be adversarial. Patterns with catastrophic backtracking (e.g.
   * `/(a+)+$/`) can hang the eval. Test your pattern against worst-case
   * inputs before using in production.
   */
  regex(pattern: RegExp): NamedScorer {
    return {
      name: `regex(${pattern.source})`,
      score: (output): Score => {
        const ok = pattern.test(output);
        return ok ? { score: 1 } : { score: 0, reason: "regex_no_match" };
      },
    };
  },

  /**
   * Parse `output` as JSON and validate against a Zod schema.
   *
   * - EC-2 fix: output is bounded by `JSON_SHAPE_MAX_BYTES` (1 MB)
   *   BEFORE `JSON.parse` to avoid OOM on runaway LLM responses.
   * - `strict: true` includes Zod's first error message in `reason`.
   */
  /**
   * LLM-as-judge scorer (ADR D205).
   *
   * **Cost note (EC-12):** every row with this scorer adds ~1 LLM call
   * for the judge. For 1000 rows × gpt-4o-mini, expect ~2x the baseline
   * token spend. The eval `aggregate.tokensInTotal` only reflects the
   * EVAL agent's tokens, not the judge's — forecast accordingly.
   *
   * **Bias note (D205):** `apiKey` is intentionally separate so callers
   * cannot accidentally judge their own output. Pass a different key
   * (can target the same provider, but explicit by design).
   *
   * **EC-8 (parser robustness):** the regex accepts JSON inside markdown
   * code fences and prose-wrapped JSON — common LLM output shapes.
   */
  llmJudge(opts: LlmJudgeOptions): NamedScorer {
    return {
      name: "llm-judge",
      score: (output, expected) => {
        const callOpts: LlmJudgeOptions & { output: string; expected?: unknown } =
          expected !== undefined
            ? { ...opts, output, expected }
            : { ...opts, output };
        return llmJudgeScore(callOpts);
      },
    };
  },

  jsonShape<T extends ZodType>(schema: T, opts: JsonShapeOptions = {}): NamedScorer {
    return {
      name: "json-shape",
      score: (output): Score => {
        if (output.length > JSON_SHAPE_MAX_BYTES) {
          return { score: 0, reason: "output_too_large" };
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(output);
        } catch {
          return { score: 0, reason: "invalid_json" };
        }
        const result = schema.safeParse(parsed);
        if (result.success) return { score: 1 };
        if (opts.strict === true) {
          const issue = (result.error as z.ZodError).issues?.[0];
          return { score: 0, reason: `schema_invalid: ${issue?.message ?? "?"}` };
        }
        return { score: 0, reason: "schema_invalid" };
      },
    };
  },
};
