import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  isLanceAvailable,
  LanceIndex,
  lanceStoragePath,
} from "../../../src/internal/memory/lance-index.js";
import { resolveMemoryRoot } from "../../../src/internal/memory/storage/memory-root.js";

/**
 * SOURCE-LEVEL guards on `lance-index.ts` — Phase 5 of v1.2 plan (ADR D43).
 *
 * The name matters because the old one over-promised. This file calls into `LanceIndex` at exactly
 * ONE line, inside `it.skipIf(isLanceAvailable())` — and `@lancedb/lancedb` IS resolvable in this
 * workspace, so on any machine with the peer installed the file executes zero calls into the class it
 * is named for. That gate is right: the test exists so the unavailable-backend error path is not
 * claimed when the module is there. What was wrong was the title around it.
 *
 * What the running cases DO cover, and it is worth having:
 *   - EC-1 — a source sentinel that fails if `.where()` regains raw `${variable}` interpolation or
 *     loses `escapeSqlValue`. Lance's predicate API takes a SQL string and supports no bind
 *     parameters, so the escape is the only defence and a static check is the only cheap guard.
 *   - EC-8 — the dimension-mismatch code and message exist in the source.
 *   - path helpers, which need no peer.
 *
 * THE BEHAVIOURAL COVERAGE IS ELSEWHERE and is correctly gated:
 * `tests/integration/lance-end-to-end.test.ts` runs 13 cases against the real peer.
 *
 * Three tests were deleted rather than kept: two built a `ConfigurationError` and asserted it had
 * the code they had just passed it, under names claiming the code "is informative"; one assigned
 * `{ backend: "lance" }` to a type alias and asserted the value it had written. None said anything
 * about Lance.
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

  // Two tests stood here: `new ConfigurationError("test", { code: X })` followed by
  // `expect(err.code).toBe(X)`, under names claiming the code "is informative" — which no assertion
  // checked. They asserted that a constructor assigns its argument, in a file named for LanceIndex.
  // Both codes ARE covered where they mean something: `lance_backend_unavailable` by the skipIf test
  // above, `embedding_dimension_mismatch` by the source sentinel below and by
  // tests/integration/lance-end-to-end.test.ts against the real peer.

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

  // `it("memory types accept backend: 'lance'")` stood here, assigning
  // `{ backend: "lance" }` to a type alias and asserting the value it had just written. The
  // compile-time claim it makes is real and is made by every other file that types a Lance option;
  // the runtime assertion was tautological.
});
