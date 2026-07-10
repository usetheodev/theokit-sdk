/**
 * #57 — content-level defense for tool results before they reach the LLM.
 *
 * Two opt-in behaviors, applied at the `transform_tool_result` seam (#65):
 *  - `delimit`: wrap untrusted tool output in explicit data boundaries
 *    ("spotlighting") so the model treats it as DATA, not instructions — the
 *    primary mitigation against tool-result prompt injection. Non-destructive:
 *    the content is preserved, only framed. A boundary marker appearing inside
 *    the content is neutralized so it cannot break out of the frame.
 *  - `redactPii`: replace common PII patterns (email, phone) with `[REDACTED]`.
 *
 * @internal
 */

import { renderToolResultContentText } from "../llm/tool-result-content.js";
import type { LlmContentPart } from "../llm/types.js";

export interface ToolResultGuardOptions {
  /** Wrap tool-result content in explicit data boundaries (spotlighting). */
  delimit?: boolean;
  /** Redact common PII patterns (email, phone) in tool-result content. */
  redactPii?: boolean;
}

const OPEN = "<untrusted-tool-output>";
const CLOSE = "</untrusted-tool-output>";

const PII_PATTERNS: readonly RegExp[] = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, // email
  /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, // phone
];

function guardText(content: string, opts: ToolResultGuardOptions): string {
  let out = content;
  if (opts.redactPii === true) {
    for (const re of PII_PATTERNS) out = out.replace(re, "[REDACTED]");
  }
  if (opts.delimit === true) {
    // Neutralize any attempt to forge the closing boundary from inside the data.
    const safe = out.split(CLOSE).join("</ untrusted-tool-output>");
    out = `${OPEN}\n${safe}\n${CLOSE}`;
  }
  return out;
}

/**
 * Apply the tool-result guard to the tool_result parts of a content array. When
 * neither behavior is enabled the array is returned unchanged (zero overhead).
 */
export function applyToolResultGuard(
  parts: readonly LlmContentPart[],
  opts: ToolResultGuardOptions,
): LlmContentPart[] {
  if (opts.delimit !== true && opts.redactPii !== true) return parts as LlmContentPart[];
  return parts.map((p) =>
    // SE7 — guard the TEXT of a tool result (string or the text blocks of a
    // structured content); image blocks pass through untouched.
    p.type === "tool_result"
      ? { ...p, content: renderToolResultContentText(p.content, (t) => guardText(t, opts)) }
      : p,
  );
}
