/**
 * SE7 — `ToolError`: thrown FROM a tool `handler` to report a failure back to
 * the model with structured content (text and/or an image), not just a string.
 * Kept in its own module (not `errors.ts`) so the error taxonomy file stays
 * under the G8 LoC budget and this tool-shaped error lives next to the tool
 * surface it serves.
 *
 * @public
 */

import { type ErrorMetadata, TheokitAgentError } from "./errors.js";
import type { ToolResultContentBlock } from "./types/content-blocks.js";

/**
 * Thrown from a tool `handler` to surface a failure to the model. The SDK turns
 * it into a `tool_result` with `isError: true` carrying the content. A plain
 * `Error` thrown from a handler still works (its message becomes text);
 * `ToolError` is the opt-in for a clean message or a multimodal error (e.g. an
 * error screenshot).
 *
 * @public
 */
export class ToolError extends TheokitAgentError {
  override readonly name: string = "ToolError";
  /** The error content surfaced to the model: a string, or text/image blocks. */
  readonly content: string | ToolResultContentBlock[];

  constructor(
    content: string | ToolResultContentBlock[],
    options: { code?: string; cause?: unknown; metadata?: ErrorMetadata } = {},
  ) {
    super(renderToolErrorMessage(content), { ...options, isRetryable: false });
    this.content = content;
  }
}

/** Render a `ToolError`'s content into a plain-text `Error.message`. */
function renderToolErrorMessage(content: string | ToolResultContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .map((block) => (block.type === "text" ? block.text : `[${block.source.media_type} image]`))
    .join("\n");
}
