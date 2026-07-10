/**
 * SE25 — deterministic, no-LLM guardrail processors built on the SE24
 * {@link Processor} seam. Cheap and churn-free (no provider/model deltas), so
 * they are safe to own in-core — unlike the LLM-classifier processors, which are
 * delegated (see the guardrails ADR). All are OPT-IN: add them to
 * `AgentOptions.inputProcessors` / `outputProcessors`.
 *
 * @public
 */

import type { Processor, ProcessorControls } from "./types/processors.js";

/** Rough char→token ratio for the estimate below (no tokenizer dependency). */
const CHARS_PER_TOKEN = 4;

/**
 * Approximate token count from character length. This is an ESTIMATE (≈ chars/4),
 * NOT an exact per-model tokenizer count — good enough for a coarse cap, and
 * dependency-free.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Options for {@link createUnicodeNormalizer}. @public */
export interface UnicodeNormalizerOptions {
  /** Remove C0 control chars + DEL (keeps tab / newline / carriage-return). Default `false`. */
  stripControlChars?: boolean;
  /** Collapse runs of intra-line whitespace to one space, 3+ blank lines to one, and trim. Default `false`. */
  collapseWhitespace?: boolean;
}

// C0 control chars (U+0000–U+001F) + DEL (U+007F), EXCLUDING tab (U+0009),
// line feed (U+000A), and carriage return (U+000D) so line structure survives.
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — this processor's whole job is to strip control characters (written with \u escapes, no literal control char in source).
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * SE25 — an input processor that normalizes user text: Unicode NFC (so
 * canonically-equivalent sequences compare equal) plus optional control-char
 * stripping and whitespace collapsing. Pure + deterministic; no LLM. Mirrors
 * a peer framework's `UnicodeNormalizer`.
 *
 * @public
 */
export function createUnicodeNormalizer(opts: UnicodeNormalizerOptions = {}): Processor {
  const stripControlChars = opts.stripControlChars ?? false;
  const collapseWhitespace = opts.collapseWhitespace ?? false;
  return {
    id: "unicode-normalizer",
    processInput(ctx) {
      let s = ctx.message.normalize("NFC");
      if (stripControlChars) s = s.replace(CONTROL_CHARS, "");
      if (collapseWhitespace) {
        s = s
          .replace(/[^\S\n]+/g, " ") // runs of intra-line whitespace -> one space
          .replace(/ *\n */g, "\n") // drop spaces hugging a newline
          .replace(/\n{3,}/g, "\n\n") // 3+ blank lines -> one blank line
          .trim();
      }
      return s;
    },
  };
}

/** Options for {@link createTokenLimiter}. @public */
export interface TokenLimiterOptions {
  /** Positive integer token budget (estimate — see {@link estimateTokens}). */
  limit: number;
  /** Over the limit: `"truncate"` (default, cut to fit) or `"block"` (abort with a tripwire). */
  strategy?: "truncate" | "block";
}

/**
 * SE25 — a processor that caps text to a token budget. Placed in
 * `inputProcessors` it limits the prompt; in `outputProcessors` it limits the
 * response. Uses a char-based estimate (no tokenizer dep). `truncate` cuts to
 * fit; `block` aborts (tripwire). Mirrors a peer framework's `TokenLimiterProcessor`.
 *
 * @public
 */
export function createTokenLimiter(opts: TokenLimiterOptions): Processor {
  if (!Number.isInteger(opts.limit) || opts.limit <= 0) {
    throw new Error("createTokenLimiter: `limit` must be a positive integer.");
  }
  const limit = opts.limit;
  const strategy = opts.strategy ?? "truncate";
  const cap = (text: string, controls: Pick<ProcessorControls, "abort">): string => {
    if (estimateTokens(text) <= limit) return text;
    if (strategy === "block") {
      controls.abort(`exceeds token limit ${limit} (~${estimateTokens(text)} estimated)`);
    }
    return text.slice(0, limit * CHARS_PER_TOKEN);
  };
  return {
    id: "token-limiter",
    processInput: (ctx) => cap(ctx.message, ctx),
    processOutput: (ctx) => cap(ctx.text, ctx),
  };
}
