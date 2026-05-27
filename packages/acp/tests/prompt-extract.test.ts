/**
 * T3.1 — prompt-extract tests (D360).
 */

import { describe, expect, it } from "vitest";
import { extractPrompt } from "../src/prompt-extract.js";
import { PromptTooLargeError } from "../src/types.js";

const MIB = 1024 * 1024;

describe("extractPrompt", () => {
  it("extract_single_text_block", () => {
    const r = extractPrompt([{ type: "text", text: "hello" } as never], 2 * MIB);
    expect(r.text).toBe("hello");
    expect(r.attachments).toEqual([]);
  });

  it("extract_multi_text_concat_with_newline", () => {
    const r = extractPrompt(
      [{ type: "text", text: "line1" } as never, { type: "text", text: "line2" } as never],
      2 * MIB,
    );
    expect(r.text).toBe("line1\nline2");
  });

  it("extract_image_block_collected_as_attachment", () => {
    const r = extractPrompt(
      [
        { type: "text", text: "see image" } as never,
        { type: "image", mimeType: "image/png", data: "Zm9v" } as never,
      ],
      2 * MIB,
    );
    expect(r.text).toBe("see image");
    expect(r.attachments).toHaveLength(1);
    expect(r.attachments[0]?.type).toBe("image");
    expect(r.attachments[0]?.mimeType).toBe("image/png");
    expect(r.attachments[0]?.data).toBe("Zm9v");
  });

  it("extract_empty_returns_empty", () => {
    const r = extractPrompt([], 2 * MIB);
    expect(r.text).toBe("");
    expect(r.attachments).toEqual([]);
  });

  it("extract_oversized_throws_prompt_too_large", () => {
    const huge = "a".repeat(3 * MIB);
    expect(() => extractPrompt([{ type: "text", text: huge } as never], 2 * MIB)).toThrow(
      PromptTooLargeError,
    );
  });

  it("extract_utf16_surrogate_counts_utf8_bytes", () => {
    // 😀 = 4 UTF-8 bytes; "a😀b" = 1 + 4 + 1 = 6
    const r = extractPrompt([{ type: "text", text: "a😀b" } as never], 6);
    expect(r.text).toBe("a😀b");
    // exact 6-byte cap → ok; 5-byte cap → throw
    expect(() => extractPrompt([{ type: "text", text: "a😀b" } as never], 5)).toThrow(
      PromptTooLargeError,
    );
  });

  it("extract_resource_link_counted_as_attachment", () => {
    const r = extractPrompt(
      [{ type: "resource_link", uri: "file:///path/to/file.txt" } as never],
      2 * MIB,
    );
    expect(r.text).toBe("");
    expect(r.attachments).toHaveLength(1);
    expect(r.attachments[0]?.type).toBe("resource_link");
    expect(r.attachments[0]?.uri).toBe("file:///path/to/file.txt");
  });
});
