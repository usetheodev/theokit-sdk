/**
 * M2 #61 (T2.3) — RED-first: parseToolArguments must attempt jsonrepair before
 * falling back to the {raw} envelope, so a slightly-malformed native tool call
 * (trailing comma / unquoted key — the Kimi/K2 class) parses instead of bouncing
 * to the model as invalid_request.
 */
import { describe, expect, it } from "vitest";
import { parseToolArguments } from "../../../src/internal/llm/finish.js";

describe("M2 #61 — parseToolArguments jsonrepair-before-{raw}", () => {
  it("parses well-formed JSON directly", () => {
    expect(parseToolArguments('{"city":"SF","n":2}')).toEqual({ city: "SF", n: 2 });
  });

  it("repairs a trailing comma instead of wrapping in {raw}", () => {
    const out = parseToolArguments('{"a":1,}');
    expect(out).toEqual({ a: 1 });
    expect(out.raw).toBeUndefined();
  });

  it("repairs an unquoted key instead of wrapping in {raw}", () => {
    const out = parseToolArguments("{city:'SF'}");
    expect(out).toEqual({ city: "SF" });
    expect(out.raw).toBeUndefined();
  });

  it("falls back to {raw} when the buffer is genuinely unrepairable", () => {
    const out = parseToolArguments("this is not json at all <<<");
    expect(out).toEqual({ raw: "this is not json at all <<<" });
  });

  it("returns {} for empty/undefined buffer", () => {
    expect(parseToolArguments("")).toEqual({});
    expect(parseToolArguments(undefined)).toEqual({});
  });
});
