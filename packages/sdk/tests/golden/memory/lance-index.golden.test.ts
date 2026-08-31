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
import { resolveMemoryRoot } from "../../../src/internal/memory/storage/memory-root.js";

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
  // The assertion only exists when the module is genuinely absent. When it is
  // installed, report SKIPPED rather than PASS — a bare `return` here claimed
  // to cover the unavailable-backend error path while asserting nothing.
  it.skipIf(isLanceAvailable())(
    "throws ConfigurationError(lance_backend_unavailable) when module absent",
    async () => {
      const tmp = lanceStoragePath(resolveMemoryRoot("/tmp/lance-unavailable-test"));
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
    },
  );

  it("isLanceAvailable() returns boolean without throwing", () => {
    expect(typeof isLanceAvailable()).toBe("boolean");
  });

  it("lanceStoragePath returns path under the resolved memory root", () => {
    expect(lanceStoragePath(resolveMemoryRoot("/some/project"))).toBe(
      "/some/project/.theokit/memory/lance",
    );
  });

  // The half the default hides: with `memory.directory` set, the Lance store follows the root
  // rather than re-deriving `<cwd>/.theokit/memory` from a literal of its own (#463).
  it("lanceStoragePath follows a configured memory directory", () => {
    expect(lanceStoragePath(resolveMemoryRoot("/some/project", { directory: "/srv/mem" }))).toBe(
      "/srv/mem/lance",
    );
  });

  it("ConfigurationError code 'lance_backend_unavailable' is informative", () => {
    const err = new ConfigurationError("test", { code: "lance_backend_unavailable" });
    expect(err.code).toBe("lance_backend_unavailable");
  });

  it("ConfigurationError code 'embedding_dimension_mismatch' is informative", () => {
    const err = new ConfigurationError("test", { code: "embedding_dimension_mismatch" });
    expect(err.code).toBe("embedding_dimension_mismatch");
  });

  it("EC-1 MUST FIX: source code escapes user input in SQL predicates, NEVER raw interpolation", () => {
    // Static analysis sentinel: Lance 0.30.0's `.where()` accepts SQL string
    // ONLY (object filter rejected; discovered 2026-05-31 via integration
    // test under lancedb-backend-ship-v1-1 plan). EC-1 is preserved via
    // the `escapeSqlValue()` helper that doubles single-quotes — standard
    // SQL string-literal escape; bind parameters are not supported in
    // Lance's predicate API. This test fails if a future refactor drops
    // the escape OR re-introduces raw `${variable}` interpolation.
    const srcPath = resolve(here, "../../../src/internal/memory/lance-index.ts");
    const src = readFileSync(srcPath, "utf8");
    // Disallow: raw .where(`...${variable}...`) interpolation without escape.
    expect(src).not.toMatch(/\.where\(`[^`]*\$\{opts\.namespace[^`]*\}/);
    expect(src).not.toMatch(/\.where\(`[^`]*\$\{opts\.scope[^`]*\}/);
    // Positive: escapeSqlValue() helper exists AND is invoked on both
    // namespace and scope in the search() implementation.
    expect(src).toMatch(/function escapeSqlValue\(/);
    expect(src).toMatch(/escapeSqlValue\(opts\.namespace\)/);
    expect(src).toMatch(/escapeSqlValue\(opts\.scope\)/);
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
