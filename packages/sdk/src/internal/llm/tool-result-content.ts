/**
 * SE7 — provider-agnostic helpers for structured tool-result content
 * ({@link ToolResultContentBlock}). Named by CAPABILITY, not by provider:
 *
 * - `toBlockToolResultContent` — for a wire that ACCEPTS content blocks.
 * - `toStringToolResultContent` — for a string-only wire (fail-fast on an image).
 * - `renderToolResultContentText` — map the text parts through a fn (for the guard).
 *
 * @internal
 */

import { ConfigurationError } from "../../errors.js";
import type { ToolResultContentBlock } from "../../types/content-blocks.js";

/**
 * For a block-capable provider wire: pass a string through unchanged, or forward
 * the structured blocks as-is (text + image).
 *
 * This is an INTENTIONAL identity: `ToolResultContentBlock` is defined to be
 * exactly the on-wire content-block shape that block-capable providers accept
 * for a tool result — `{ type: "text", text }` and
 * `{ type: "image", source: { type: "base64", media_type, data } }`. Because the
 * SDK type already IS the wire shape, no transformation is needed; this function
 * names that contract at the call site (and is the single seam to add a mapping
 * later, if a block-capable wire ever diverges from this shape). Do NOT add
 * SDK-internal fields to `ToolResultContentBlock` without updating this seam —
 * they would otherwise be forwarded verbatim onto the wire.
 */
export function toBlockToolResultContent(
  content: string | ToolResultContentBlock[],
): string | ToolResultContentBlock[] {
  return content;
}

/**
 * For a string-only provider wire: pass a string through; flatten text-only
 * blocks to a newline-joined string; **fail fast** with a typed
 * {@link ConfigurationError} when an image block is present — that provider
 * cannot carry an image in a tool result, and silently dropping it would hand
 * the model a lie (per error-handling policy).
 */
export function toStringToolResultContent(
  content: string | ToolResultContentBlock[],
  providerName: string,
): string {
  if (typeof content === "string") return content;
  if (content.some((block) => block.type === "image")) {
    throw new ConfigurationError(
      `provider "${providerName}" does not support image content in tool results`,
    );
  }
  return content
    .filter(
      (block): block is Extract<ToolResultContentBlock, { type: "text" }> => block.type === "text",
    )
    .map((block) => block.text)
    .join("\n");
}

/**
 * Apply `fn` to the text of a tool-result content (both the string form and the
 * text blocks of the structured form); image blocks pass through untouched.
 * Used by the tool-result guard so redaction/delimiting still covers text.
 */
export function renderToolResultContentText(
  content: string | ToolResultContentBlock[],
  fn: (text: string) => string,
): string | ToolResultContentBlock[] {
  if (typeof content === "string") return fn(content);
  return content.map((block) =>
    block.type === "text" ? { type: "text" as const, text: fn(block.text) } : block,
  );
}
