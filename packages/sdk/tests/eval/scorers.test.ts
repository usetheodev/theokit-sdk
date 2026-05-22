/**
 * Built-in scorers (ADR D203). Covers all 4 plus EC-1 (empty expected)
 * and EC-2 (oversize output cap).
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { Scorers } from "../../src/scorers.js";
import type { NamedScorer, Score } from "../../src/types/eval.js";

/** Helper: await the scorer return (sync or async) and cast to Score. */
async function run(scorer: NamedScorer, output: string, expected?: unknown): Promise<Score> {
  const r = scorer.score(output, expected);
  return r instanceof Promise ? await r : r;
}

describe("Scorers.exactMatch", () => {
  it("matches identical strings (case-sensitive default)", async () => {
    const s = Scorers.exactMatch();
    expect((await run(s, "hello", "hello")).score).toBe(1);
    expect((await run(s, "HELLO", "hello")).score).toBe(0);
  });

  it("matches case-insensitively when opted in", async () => {
    const s = Scorers.exactMatch({ caseSensitive: false });
    expect((await run(s, "HELLO", "hello")).score).toBe(1);
  });

  it("trims whitespace", async () => {
    const s = Scorers.exactMatch();
    expect((await run(s, "  ok  ", "ok")).score).toBe(1);
  });

  it("returns expected_not_string when expected is not a string", async () => {
    const s = Scorers.exactMatch();
    expect((await run(s, "x", 42)).reason).toBe("expected_not_string");
  });

  it("EC-1: rejects empty expected with reason=expected_empty", async () => {
    const s = Scorers.exactMatch();
    expect((await run(s, "", "")).reason).toBe("expected_empty");
    expect((await run(s, "anything", "")).score).toBe(0);
  });

  it("returns mismatch reason on diff", async () => {
    const s = Scorers.exactMatch();
    expect((await run(s, "a", "b")).reason).toBe("mismatch");
  });
});

describe("Scorers.containsExpected", () => {
  it("matches case-insensitive by default", async () => {
    const s = Scorers.containsExpected();
    expect((await run(s, "Hello World", "WORLD")).score).toBe(1);
  });

  it("respects caseSensitive: true", async () => {
    const s = Scorers.containsExpected({ caseSensitive: true });
    expect((await run(s, "Hello World", "world")).score).toBe(0);
    expect((await run(s, "Hello World", "World")).score).toBe(1);
  });

  it("EC-1: rejects empty expected (otherwise silent inflated pass)", async () => {
    const s = Scorers.containsExpected();
    expect((await run(s, "anything", "")).score).toBe(0);
    expect((await run(s, "anything", "")).reason).toBe("expected_empty");
  });

  it("returns not_found reason on miss", async () => {
    const s = Scorers.containsExpected();
    expect((await run(s, "foo", "bar")).reason).toBe("not_found");
  });

  it("returns expected_not_string when expected is wrong type", async () => {
    const s = Scorers.containsExpected();
    expect((await run(s, "x", { not: "string" })).reason).toBe("expected_not_string");
  });
});

describe("Scorers.regex", () => {
  it("matches when pattern hits", async () => {
    const s = Scorers.regex(/jazz/i);
    expect((await run(s, "I love JAZZ music")).score).toBe(1);
  });

  it("returns regex_no_match on miss", async () => {
    const s = Scorers.regex(/banana/);
    expect((await run(s, "apple")).score).toBe(0);
    expect((await run(s, "apple")).reason).toBe("regex_no_match");
  });

  it("scorer.name embeds pattern source", () => {
    const s = Scorers.regex(/foo|bar/i);
    expect(s.name).toBe("regex(foo|bar)");
  });
});

describe("Scorers.jsonShape", () => {
  const schema = z.object({ name: z.string(), age: z.number() });

  it("scores 1 when output is valid JSON matching schema", async () => {
    const s = Scorers.jsonShape(schema);
    expect((await run(s, '{"name":"alice","age":30}')).score).toBe(1);
  });

  it("scores 0 with invalid_json reason on parse failure", async () => {
    const s = Scorers.jsonShape(schema);
    const result = await run(s, "not json");
    expect(result.score).toBe(0);
    expect(result.reason).toBe("invalid_json");
  });

  it("scores 0 with schema_invalid reason on shape mismatch", async () => {
    const s = Scorers.jsonShape(schema);
    const result = await run(s, '{"name":"alice"}');
    expect(result.score).toBe(0);
    expect(result.reason).toBe("schema_invalid");
  });

  it("strict mode includes Zod error in reason", async () => {
    const s = Scorers.jsonShape(schema, { strict: true });
    const result = await run(s, '{"name":"alice"}');
    expect(result.score).toBe(0);
    expect(result.reason).toMatch(/schema_invalid:/);
  });

  it("EC-2: output > 1 MB rejected with output_too_large", async () => {
    const s = Scorers.jsonShape(z.any());
    const huge = "a".repeat(1_500_000);
    const result = await run(s, huge);
    expect(result.score).toBe(0);
    expect(result.reason).toBe("output_too_large");
  });
});
