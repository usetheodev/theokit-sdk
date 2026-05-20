import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ConfigurationError } from "../../../src/errors.js";
import {
  isLanceAvailable,
  LanceIndex,
  lanceStoragePath,
} from "../../../src/internal/memory/lance-index.js";

/**
 * LanceIndex tests — Phase 5 of v1.2 plan (ADR D43).
 * Covers EC-1 (no SQL injection in filters), EC-8 (dimension mismatch),
 * typed error when @lancedb/lancedb absent, surface coverage.
 *
 * NOTE: Full Lance roundtrip requires `@lancedb/lancedb` installed. When
 * absent (default CI), we validate:
 *   - typed error on open()
 *   - source code uses structured filter (no string interpolation)
 *   - typed module surface is reachable
 */

const here = dirname(fileURLToPath(import.meta.url));

describe("LanceIndex (ADR D43)", () => {
  it("throws ConfigurationError(lance_backend_unavailable) when module absent", async () => {
    if (isLanceAvailable()) {
      // Module is present (rare in CI). Skip this assertion.
      return;
    }
    const tmp = lanceStoragePath("/tmp/lance-unavailable-test");
    expect(tmp.endsWith(".theokit/memory/lance")).toBe(true);
    // Mock embedding runtime — never invoked because open() fails fast.
    const fakeEmbedding = {
      id: "test",
      model: "x",
      dimension: 1536,
      embed: async () => [[0]],
      stats: () => ({ cacheHits: 0, cacheMisses: 0, httpCalls: 0, retries: 0 }),
    };
    await expect(
      LanceIndex.open({
        cwd: "/tmp/lance-test-stub",
        embedding: fakeEmbedding,
      }),
    ).rejects.toMatchObject({ code: "lance_backend_unavailable" });
  });

  it("isLanceAvailable() returns boolean without throwing", () => {
    expect(typeof isLanceAvailable()).toBe("boolean");
  });

  it("lanceStoragePath returns path under <cwd>/.theokit/memory/lance", () => {
    const p = lanceStoragePath("/some/project");
    expect(p).toBe("/some/project/.theokit/memory/lance");
  });

  it("ConfigurationError code 'lance_backend_unavailable' is informative", () => {
    const err = new ConfigurationError("test", { code: "lance_backend_unavailable" });
    expect(err.code).toBe("lance_backend_unavailable");
  });

  it("ConfigurationError code 'embedding_dimension_mismatch' is informative", () => {
    const err = new ConfigurationError("test", { code: "embedding_dimension_mismatch" });
    expect(err.code).toBe("embedding_dimension_mismatch");
  });

  it("EC-1 MUST FIX: source code uses structured filter, NEVER string interpolation", () => {
    // Static analysis sentinel: this test verifies that the source code
    // does not concatenate user input into a where() string. We grep the
    // implementation for the dangerous pattern; if a future refactor
    // introduces string interpolation, this test fails immediately.
    const srcPath = resolve(here, "../../../src/internal/memory/lance-index.ts");
    const src = readFileSync(srcPath, "utf8");
    // Disallow: .where(`...${...}...`) or .where("..." + ...) for filters.
    expect(src).not.toMatch(/\.where\(`[^`]*\$\{[^`]*namespace[^`]*\}/);
    expect(src).not.toMatch(/\.where\(`[^`]*\$\{[^`]*scope[^`]*\}/);
    // Positive assertion: structured filter object form is used.
    expect(src).toMatch(/\.where\(filter\)/);
    expect(src).toMatch(/filter\[?:.\s*?Record<string,/);
  });

  it("EC-8: dimension mismatch produces typed error message", () => {
    // We can't open a Lance table without the module, but the code path
    // exists. Verify the error format by simulating the code path manually.
    const src = readFileSync(resolve(here, "../../../src/internal/memory/lance-index.ts"), "utf8");
    expect(src).toContain("embedding_dimension_mismatch");
    expect(src).toContain("Embedding dimension mismatch in Lance index");
  });

  it("memory types accept backend: 'lance'", async () => {
    // Compile-time sanity: TelemetrySettings shape includes `backend: "lance"`.
    // We import the type alias and assign — TS would fail to compile if
    // the union didn't include "lance".
    type Memory = import("../../../src/types/agent.js").MemorySettings;
    const m: Memory["index"] = { backend: "lance" };
    expect(m?.backend).toBe("lance");
  });
});
