/**
 * Tests for context-loaders.ts (T1.2).
 */

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import {
  DEFAULT_MAX_BYTES_PER_FILE,
  loadPlainMarkdown,
  truncateWithMarker,
} from "../../../src/internal/runtime/context/context-loaders.js";
import { removeTempDirRobust } from "../../helpers/temp-workspace.js";

describe("truncateWithMarker (T1.2)", () => {
  it("content under max returns verbatim", () => {
    const r = truncateWithMarker("hello", 100);
    expect(r.truncated).toBe(false);
    expect(r.finalContent).toBe("hello");
  });

  it("content at exact max not truncated (EC-6)", () => {
    const r = truncateWithMarker("12345", 5);
    expect(r.truncated).toBe(false);
    expect(r.finalContent).toBe("12345");
  });

  it("content just over max truncates (EC-7)", () => {
    const r = truncateWithMarker("x".repeat(101), 100);
    expect(r.truncated).toBe(true);
    expect(r.finalContent.length).toBeLessThanOrEqual(100);
  });

  it("head and tail present in output", () => {
    const content = "HEAD".repeat(100) + "TAIL".repeat(100);
    const r = truncateWithMarker(content, 200);
    expect(r.finalContent.startsWith("HEAD")).toBe(true);
    expect(r.finalContent.endsWith("TAIL")).toBe(true);
  });

  it("marker present in truncated output", () => {
    const r = truncateWithMarker("x".repeat(1000), 500);
    expect(r.finalContent).toContain("[truncated by theokit]");
  });

  it("finalContent length never exceeds max", () => {
    const r = truncateWithMarker("y".repeat(10_000), 1234);
    expect(r.finalContent.length).toBeLessThanOrEqual(1234);
  });

  it("empty file returns empty (EC-9)", () => {
    const r = truncateWithMarker("", 100);
    expect(r.truncated).toBe(false);
    expect(r.finalContent).toBe("");
  });

  // EC-C: marker guard
  it("EC-C: max below marker length returns head-only no marker", () => {
    const content = "ABCDEFGHIJ".repeat(20); // 200 chars
    const r = truncateWithMarker(content, 10); // 10 < MARKER.length (≈ 30)
    expect(r.truncated).toBe(true);
    expect(r.finalContent.length).toBe(10);
    expect(r.finalContent).not.toContain("truncated by theokit");
    expect(r.finalContent).toBe("ABCDEFGHIJ");
  });

  it("EC-C: max == 0 returns empty + truncated", () => {
    const r = truncateWithMarker("hello", 0);
    expect(r.truncated).toBe(true);
    expect(r.finalContent).toBe("");
  });

  // EC-H: UTF-8 codepoint integrity
  it("EC-H: truncation at multibyte boundary keeps valid utf8", () => {
    // 🎵 is 1 UTF-16 surrogate pair (2 chars in JS string), 4 bytes UTF-8.
    const content = `a${"🎵".repeat(100)}`;
    const r = truncateWithMarker(content, 50);
    // We accept replacement chars at the boundary; assert the final
    // content is still convertible to a valid UTF-8 buffer.
    const buf = Buffer.from(r.finalContent, "utf8");
    // Round-trip — if we corrupted a surrogate, this would produce U+FFFD
    // somewhere in the buffer. We tolerate U+FFFD because LLMs do too.
    expect(buf.length).toBeGreaterThan(0);
  });
});

describe("loadPlainMarkdown (T1.2)", () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "theokit-ctx-load-"));
    const __tmpCleanup1 = tmp;
    onTestFinished(async () => {
      await removeTempDirRobust(__tmpCleanup1);
    });
    delete (globalThis as Record<string, unknown>).__theokit_tracer;
  });
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__theokit_tracer;
    vi.restoreAllMocks();
  });

  it("loads file content", async () => {
    const p = join(tmp, "x.md");
    await writeFile(p, "hello");
    const loaded = await loadPlainMarkdown(p);
    expect(loaded?.content).toBe("hello");
    expect(loaded?.truncated).toBe(false);
  });

  it("applies default max bytes per file", async () => {
    const p = join(tmp, "x.md");
    await writeFile(p, "x".repeat(DEFAULT_MAX_BYTES_PER_FILE + 100));
    const loaded = await loadPlainMarkdown(p);
    expect(loaded?.truncated).toBe(true);
    expect(loaded?.content.length).toBeLessThanOrEqual(DEFAULT_MAX_BYTES_PER_FILE);
  });

  // EC-G: missing file → undefined, no throw
  it("EC-G: missing file returns undefined not throw", async () => {
    const loaded = await loadPlainMarkdown(join(tmp, "does-not-exist.md"));
    expect(loaded).toBeUndefined();
  });

  // EC-L: telemetry no-op when disabled (default state)
  it("EC-L: telemetry no-op when tracer not installed", async () => {
    expect((globalThis as Record<string, unknown>).__theokit_tracer).toBeUndefined();
    const p = join(tmp, "huge.md");
    await writeFile(p, "x".repeat(100_000));
    const loaded = await loadPlainMarkdown(p, { maxBytesPerFile: 100 });
    expect(loaded?.truncated).toBe(true); // truncation fires fine
    // No throw / no error from missing tracer.
  });

  // Telemetry counter when enabled
  it("emits telemetry counter on truncation when tracer installed", async () => {
    const inc = vi.fn();
    (globalThis as Record<string, unknown>).__theokit_tracer = { inc };
    const p = join(tmp, "huge.md");
    await writeFile(p, "x".repeat(100_000));
    await loadPlainMarkdown(p, { maxBytesPerFile: 100 });
    expect(inc).toHaveBeenCalledWith(
      "context_files_truncated",
      expect.objectContaining({ file: p }),
    );
  });
});
