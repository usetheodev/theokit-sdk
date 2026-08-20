/**
 * Extract user text + attachments from ACP `ContentBlock[]` with size cap (D360).
 *
 * The size cap is a RUNNING total over the blocks in order, checked after each one, so the first
 * block to cross it aborts the whole extraction and later blocks are never measured.
 *
 * @internal
 */

import type * as acp from "@agentclientprotocol/sdk";
import { PromptTooLargeError } from "./types.js";

interface PromptAttachment {
  type: "image" | "audio" | "resource" | "resource_link" | "embedded_resource";
  mimeType?: string;
  data?: string;
  uri?: string;
  bytes: number;
}

interface PromptExtractionResult {
  text: string;
  attachments: PromptAttachment[];
}

function utf8Bytes(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

function base64DecodedBytes(b64: string): number {
  return Math.floor((b64.length * 3) / 4);
}

interface ExtractState {
  textParts: string[];
  attachments: PromptAttachment[];
  totalBytes: number;
  maxBytes: number;
}

function recordBytes(state: ExtractState, bytes: number): void {
  state.totalBytes += bytes;
  if (state.totalBytes > state.maxBytes) {
    throw new PromptTooLargeError(state.totalBytes, state.maxBytes);
  }
}

function processBlock(block: acp.ContentBlock, state: ExtractState): void {
  switch (block.type) {
    case "text":
      recordBytes(state, utf8Bytes(block.text));
      state.textParts.push(block.text);
      return;
    case "image": {
      const data = block.data ?? "";
      const bytes = base64DecodedBytes(data);
      recordBytes(state, bytes);
      state.attachments.push({ type: "image", mimeType: block.mimeType, data, bytes });
      return;
    }
    case "audio": {
      const data = block.data ?? "";
      const bytes = base64DecodedBytes(data);
      recordBytes(state, bytes);
      state.attachments.push({ type: "audio", mimeType: block.mimeType, data, bytes });
      return;
    }
    case "resource_link": {
      const uri = block.uri ?? "";
      const bytes = utf8Bytes(uri);
      recordBytes(state, bytes);
      state.attachments.push({ type: "resource_link", uri, bytes });
      return;
    }
    case "resource": {
      const bytes = utf8Bytes(JSON.stringify(block));
      recordBytes(state, bytes);
      state.attachments.push({ type: "embedded_resource", bytes });
      return;
    }
    default: {
      const _exhaustive: never = block;
      throw new Error(`unknown ContentBlock type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/**
 * Flatten one ACP prompt into the text the agent will receive, plus a description of its attachments.
 *
 * Text blocks are joined with `"\n"` in wire order. Attachments are only DESCRIBED here — the ACP
 * prompt handler forwards `text` and drops `attachments`, so an image-only prompt yields an empty
 * string and is rejected upstream as an empty prompt.
 *
 * Byte accounting per block: UTF-8 length for text, base64-decoded length for image/audio (computed
 * as `floor(len * 3 / 4)`, so padding makes it over-count by up to 2 bytes), UTF-8 length of the URI
 * for `resource_link`, and the UTF-8 length of the block's JSON form for an embedded `resource`.
 *
 * @throws PromptTooLargeError as soon as the running total exceeds `maxBytes`.
 * @throws Error on a `ContentBlock` variant this build does not know (compile-time exhaustive).
 */
export function extractPrompt(
  blocks: ReadonlyArray<acp.ContentBlock>,
  maxBytes: number,
): PromptExtractionResult {
  const state: ExtractState = { textParts: [], attachments: [], totalBytes: 0, maxBytes };
  for (const block of blocks) processBlock(block, state);
  return { text: state.textParts.join("\n"), attachments: state.attachments };
}
