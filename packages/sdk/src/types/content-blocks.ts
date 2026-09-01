/**
 * Owner: `src/` (2 of 7 importers). Derived from the import graph, not declared —
 * `tests/lint/types-name-their-owner.test.ts` re-derives it.
 *
 * Leaf module for content-block types shared by `messages.ts` (assistant/user
 * content) and `agent-prims.ts` (`CustomTool` handler results). Kept
 * import-free so both can depend on it WITHOUT the `agent-prims ↔ messages`
 * cycle (#7).
 *
 * @public
 */

/**
 * Plain text content block emitted by the assistant or user, or returned by a
 * tool.
 *
 * @public
 */
export interface TextBlock {
  type: "text";
  text: string;
}

/**
 * SE7 — a base64-encoded image block a tool can hand back as (part of) its
 * result or its `ToolError`. `media_type` is a MIME type (e.g. `"image/png"`);
 * `data` is the base64 payload without a data-URL prefix.
 *
 * Note: when a tool builds this from model- or user-influenced input, treat
 * `media_type` as UNTRUSTED — validate/allow-list it before rendering it in a
 * log or UI (it could carry newlines / control chars). The SDK only forwards it
 * (JSON-serialized onto the wire) and never executes or path-joins it.
 *
 * @public
 */
export interface ImageBlock {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
}

/**
 * SE7 — structured content a tool result may carry: text and/or images. A tool
 * `handler` may return this (success) and a `ToolError` may carry it (failure).
 * Block-capable provider wires forward it natively; string-only provider wires
 * flatten text and fail fast on an image.
 *
 * @public
 */
export type ToolResultContentBlock = TextBlock | ImageBlock;
