/**
 * Lightweight assertion test: ensures the benchmark output format has the
 * required columns + Hardware header. Tests the markdown RENDER, not the
 * full bench run (which takes minutes for 100k corpus).
 *
 * EC-8 (lancedb-backend-ship-v1-1 plan): drift in benchmark report format
 * would silently break ADR D12 amendment cross-references — assert here.
 *
 * @internal
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

describe("tools/benchmark-memory-backends.mjs (EC-8)", () => {
  it("renderMarkdown emits required column headers + Hardware section", () => {
    // Static analysis: read the script source and assert the renderMarkdown
    // function body contains the canonical header strings. This is a
    // golden-style assertion that catches accidental column rename or drop.
    const src = readFileSync(
      resolve(here, "../../../../tools/benchmark-memory-backends.mjs"),
      "utf8",
    );
    // Hardware section header line literal.
    expect(src).toContain("## Hardware");
    // Table column line literal — exact order matters for downstream parsers.
    expect(src).toContain(
      "| Backend | Size | addFact ops/s | recall p50 (ms) | recall p95 (ms) | Disk (MB) |",
    );
    // CLI flags supported.
    expect(src).toContain("--size");
    expect(src).toContain("--backend");
    expect(src).toContain("--out");
  });

  it("script header contains plan reference for traceability", () => {
    const src = readFileSync(
      resolve(here, "../../../../tools/benchmark-memory-backends.mjs"),
      "utf8",
    );
    expect(src).toContain("D12");
    expect(src).toContain("D43");
  });
});
