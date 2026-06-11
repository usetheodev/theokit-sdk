import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { truncateOutput } from "../../src/tools/truncation.js";

describe("truncateOutput", () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = join(tmpdir(), `theocode-truncation-test-${Date.now()}`);
  });

  afterEach(() => {
    if (existsSync(outputDir)) {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it("returns content unchanged when within limit", () => {
    const result = truncateOutput("short text", { maxBytes: 100, outputDir });

    expect(result.truncated).toBe(false);
    expect(result.content).toBe("short text");
    expect(result.overflowPath).toBeUndefined();
  });

  it("truncates output exceeding maxBytes", () => {
    const longText = "x".repeat(200);
    const result = truncateOutput(longText, { maxBytes: 50, outputDir });

    expect(result.truncated).toBe(true);
    expect(result.overflowPath).toBeDefined();
    expect(result.content).toContain("[Output truncated");
  });

  it("writes full content to overflow file", () => {
    const longText = "y".repeat(200);
    const result = truncateOutput(longText, { maxBytes: 50, outputDir });

    expect(result.overflowPath).toBeDefined();
    const fullContent = readFileSync(result.overflowPath!, "utf-8");
    expect(fullContent).toBe(longText);
  });

  it("EC-3: does not truncate output exactly at limit", () => {
    // "abc" is 3 bytes in UTF-8
    const result = truncateOutput("abc", { maxBytes: 3, outputDir });

    expect(result.truncated).toBe(false);
    expect(result.content).toBe("abc");
  });

  it("uses default maxBytes of 30_000", () => {
    const shortText = "a".repeat(100);
    const result = truncateOutput(shortText);

    expect(result.truncated).toBe(false);
  });

  it("creates outputDir if it does not exist", () => {
    const longText = "z".repeat(200);
    const result = truncateOutput(longText, { maxBytes: 50, outputDir });

    expect(existsSync(outputDir)).toBe(true);
    expect(result.overflowPath).toBeDefined();
  });
});
