import { describe, expect, it } from "vitest";

import { estimateTokens, TokenLimiter, UnicodeNormalizer } from "../src/built-in-processors.js";
import {
  runInputProcessors,
  runOutputProcessors,
} from "../src/internal/runtime/processors/run-processors.js";

/**
 * SE25 — deterministic in-tree processors on the SE24 seam. UnicodeNormalizer
 * (NFC + optional control-char strip + whitespace collapse) and TokenLimiter
 * (char-based estimate; truncate or block). No LLM.
 *
 * Control chars / non-BMP chars are built via String.fromCharCode / fromCodePoint
 * so no literal control character appears in this source file.
 */

const cc = String.fromCharCode;
const TAB = cc(0x09);
const LF = cc(0x0a);
const EMOJI = String.fromCodePoint(0x1f600); // 😀 (non-BMP, 2 UTF-16 code units)

describe("SE25 — UnicodeNormalizer", () => {
  it("NFC-normalizes so a decomposed sequence equals its composed form", async () => {
    const decomposed = `cafe${cc(0x0301)}`; // "e" + combining acute
    const composed = "café"; // single U+00E9
    expect(decomposed).not.toBe(composed); // different code-point sequences
    const res = await runInputProcessors([UnicodeNormalizer.create()], decomposed, "a1");
    expect(res).toEqual({ kind: "ok", value: composed });
  });

  it("strips C0 control chars + DEL but keeps tab / newline / carriage-return", async () => {
    const input = `a${cc(0x01)}bcd${TAB}e${LF}f${cc(0x7f)}`;
    const res = await runInputProcessors(
      [UnicodeNormalizer.create({ stripControlChars: true })],
      input,
      "a1",
    );
    expect(res).toEqual({ kind: "ok", value: `abcd${TAB}e${LF}f` });
  });

  it("strips C1 control chars (U+0080–U+009F)", async () => {
    const input = `a${cc(0x85)}b${cc(0x9f)}c`; // NEL + APC
    const res = await runInputProcessors(
      [UnicodeNormalizer.create({ stripControlChars: true })],
      input,
      "a1",
    );
    expect(res).toEqual({ kind: "ok", value: "abc" });
  });

  it("collapses intra-line whitespace + blank-line runs and trims", async () => {
    const input = `  hello   world ${TAB}!  ${LF}${LF}${LF}${LF}kept  `;
    const res = await runInputProcessors(
      [UnicodeNormalizer.create({ collapseWhitespace: true })],
      input,
      "a1",
    );
    expect(res).toEqual({ kind: "ok", value: `hello world !${LF}${LF}kept` });
  });

  it("composes stripControlChars + collapseWhitespace (strip before collapse)", async () => {
    const input = `  a ${cc(0x01)}   b  ${LF}${LF}${LF} c  `;
    const res = await runInputProcessors(
      [UnicodeNormalizer.create({ stripControlChars: true, collapseWhitespace: true })],
      input,
      "a1",
    );
    expect(res).toEqual({ kind: "ok", value: `a b${LF}${LF}c` });
  });

  it("defaults to NFC only (no strip/collapse)", async () => {
    const input = `a${cc(0x01)}b   c`; // control + double space preserved
    const res = await runInputProcessors([UnicodeNormalizer.create()], input, "a1");
    expect(res).toEqual({ kind: "ok", value: input });
  });
});

describe("SE25 — TokenLimiter", () => {
  it("estimateTokens is ~chars/4", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });

  it("passes text under the limit unchanged", async () => {
    const res = await runOutputProcessors([TokenLimiter.create({ limit: 10 })], "short", "a1");
    expect(res).toEqual({ kind: "ok", value: "short" });
  });

  it("passes text exactly at the limit unchanged (<= boundary)", async () => {
    const text = "x".repeat(8); // estimateTokens = ceil(8/4) = 2, limit = 2
    const res = await runOutputProcessors([TokenLimiter.create({ limit: 2 })], text, "a1");
    expect(res).toEqual({ kind: "ok", value: text });
  });

  it("truncates text over the limit (default strategy)", async () => {
    const text = "x".repeat(40); // ~10 tokens
    const res = await runOutputProcessors([TokenLimiter.create({ limit: 2 })], text, "a1");
    expect(res).toEqual({ kind: "ok", value: "x".repeat(8) }); // 2 tokens * 4 chars
  });

  it("truncates on code points — never splits a surrogate pair (HIGH-1)", async () => {
    // "a😀a😀" = 6 UTF-16 code units; a code-unit slice(0,4) would end in a lone
    // high surrogate. Code-point truncation cuts on whole characters instead.
    const text = `a${EMOJI}a${EMOJI}`;
    const res = await runOutputProcessors([TokenLimiter.create({ limit: 1 })], text, "a1");
    expect(res.kind).toBe("ok");
    if (res.kind === "ok") {
      for (const ch of res.value) {
        const cp = ch.codePointAt(0) ?? 0;
        expect(cp >= 0xd800 && cp <= 0xdfff).toBe(false); // no lone surrogate
      }
      expect([...res.value]).toEqual(["a", EMOJI, "a", EMOJI]); // 4 whole code points
    }
  });

  it("blocks (tripwire) text over the limit when strategy is 'block'", async () => {
    const text = "y".repeat(40);
    const res = await runOutputProcessors(
      [TokenLimiter.create({ limit: 2, strategy: "block" })],
      text,
      "a1",
    );
    expect(res.kind).toBe("tripwire");
    if (res.kind === "tripwire") {
      expect(res.tripwire.processorId).toBe("token-limiter");
      expect(res.tripwire.reason).toContain("exceeds token limit 2");
    }
  });

  it("works as an INPUT processor too (caps the prompt)", async () => {
    const res = await runInputProcessors([TokenLimiter.create({ limit: 1 })], "abcdefgh", "a1");
    expect(res).toEqual({ kind: "ok", value: "abcd" });
  });

  it("fails fast on a non-positive or non-integer limit", () => {
    expect(() => TokenLimiter.create({ limit: 0 })).toThrow(/positive integer/);
    expect(() => TokenLimiter.create({ limit: -3 })).toThrow(/positive integer/);
    expect(() => TokenLimiter.create({ limit: 1.5 })).toThrow(/positive integer/);
    expect(() => TokenLimiter.create({ limit: Number.NaN })).toThrow(/positive integer/);
    expect(() => TokenLimiter.create({ limit: Number.POSITIVE_INFINITY })).toThrow(
      /positive integer/,
    );
  });
});
