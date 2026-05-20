/**
 * Tests for context-aggregator.ts (T4.1).
 */

import { describe, expect, it } from "vitest";

import {
  type AggregatorSource,
  applyAggregateCap,
} from "../../../src/internal/runtime/context-aggregator.js";

function src(id: string, sourcePath: string, content: string, priority: number): AggregatorSource {
  return { id, source: sourcePath, content, priority, truncated: false };
}

describe("applyAggregateCap (T4.1)", () => {
  it("under total keeps all", () => {
    const r = applyAggregateCap([src("a", "/a", "AAA", 10), src("b", "/b", "BBB", 20)], 100);
    expect(r.kept.length).toBe(2);
    expect(r.dropped).toEqual([]);
  });

  it("at exact total keeps all (EC-25)", () => {
    const r = applyAggregateCap([src("a", "/a", "12345", 10), src("b", "/b", "67890", 20)], 10);
    expect(r.kept.length).toBe(2);
    expect(r.dropped).toEqual([]);
  });

  it("just over total truncates last partial", () => {
    const r = applyAggregateCap(
      [src("a", "/a", "12345", 10), src("b", "/b", "67890", 20)],
      8, // a uses 5, b would use 5 more → 10 > 8; remaining = 3
    );
    expect(r.kept.length).toBe(2);
    expect(r.kept[1]?.content.length).toBeLessThanOrEqual(3);
    expect(r.kept[1]?.truncated).toBe(true);
  });

  it("well over total drops lower priority", () => {
    const r = applyAggregateCap(
      [
        src("a", "/a", "x".repeat(100), 10),
        src("b", "/b", "y".repeat(100), 20),
        src("c", "/c", "z".repeat(100), 30),
      ],
      150,
    );
    expect(r.kept.map((k) => k.id)).toContain("a");
    expect(r.dropped.length).toBeGreaterThanOrEqual(1);
    // Lower-priority (higher number) is dropped first
    expect(r.dropped.some((d) => d.id === "c")).toBe(true);
  });

  it("single huge source truncated to max (EC-24)", () => {
    const r = applyAggregateCap([src("a", "/a", "x".repeat(10_000), 10)], 1000);
    expect(r.kept.length).toBe(1);
    expect(r.kept[0]?.content.length).toBeLessThanOrEqual(1000);
    expect(r.kept[0]?.truncated).toBe(true);
  });

  it("telemetry emitted on drop", () => {
    const events: Array<{ k: string; attrs: unknown }> = [];
    (globalThis as Record<string, unknown>).__theokit_tracer = {
      inc: (k: string, attrs: unknown) => events.push({ k, attrs }),
    };
    try {
      applyAggregateCap(
        [src("a", "/a", "x".repeat(100), 10), src("b", "/b", "y".repeat(100), 20)],
        50,
      );
      expect(events.some((e) => e.k === "context_files_total_truncated")).toBe(true);
    } finally {
      delete (globalThis as Record<string, unknown>).__theokit_tracer;
    }
  });

  // EC-J: tie-break stability
  it("EC-J: same-priority sort tie-break by path lex deterministic", () => {
    // Build same-priority sources in non-lex order.
    const inputs = [
      src("a", "/zeta.md", "Z", 50),
      src("b", "/alpha.md", "A", 50),
      src("c", "/mu.md", "M", 50),
    ];
    const r1 = applyAggregateCap(inputs, 100);
    const r2 = applyAggregateCap([...inputs].reverse(), 100);
    // Both runs produce kept array in the SAME lex-asc order regardless
    // of input order — prompt-cache stability invariant.
    expect(r1.kept.map((k) => k.source)).toEqual(["/alpha.md", "/mu.md", "/zeta.md"]);
    expect(r2.kept.map((k) => k.source)).toEqual(["/alpha.md", "/mu.md", "/zeta.md"]);
  });
});
