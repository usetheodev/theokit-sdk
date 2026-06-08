/**
 * sdk-memory `memory-index` export smoke test (iter 50).
 *
 * Validates the iter 50 hybrid copy of `internal/memory/memory-index.ts`
 * from sdk-core. sdk-memory now ships the canonical `MemoryIndex`
 * interface (OCP-preserving 4-method contract) + `SyncResult` +
 * `parseSearchOptions` helper that future sqlite-vec/lance index
 * moves will target as siblings.
 *
 * sdk-core retains its copy for v1.x back-compat.
 * Both copies are byte-identical today; semver-major reconciliation
 * happens when Stage 3 source-move completes.
 */

import type {
  IndexStatus,
  MemoryIndex,
  MemorySearchHit,
  SearchOptions,
  SyncResult,
} from "@theokit/sdk-memory";
import { parseSearchOptions } from "@theokit/sdk-memory";
import { describe, expect, expectTypeOf, it } from "vitest";

describe("sdk-memory memory-index (iter 50)", () => {
  it("test_SyncResult_shape_pinned", () => {
    expectTypeOf<SyncResult>().toMatchTypeOf<{
      filesScanned: number;
      filesUpdated: number;
      chunksWritten: number;
      chunksEmbedded: number;
    }>();
  });

  it("test_MemoryIndex_interface_4_methods_pinned", () => {
    expectTypeOf<MemoryIndex>().toMatchTypeOf<{
      sync: () => Promise<SyncResult>;
      search: (q: string, opts?: SearchOptions) => Promise<MemorySearchHit[]>;
      status: () => IndexStatus;
      close: () => Promise<void> | void;
    }>();
  });

  it("test_parseSearchOptions_defaults_to_10_max_and_0_floor", () => {
    expect(parseSearchOptions()).toEqual({ maxResults: 10, minScore: 0 });
    expect(parseSearchOptions({})).toEqual({ maxResults: 10, minScore: 0 });
  });

  it("test_parseSearchOptions_honors_maxResults_cap_floor_at_1", () => {
    expect(parseSearchOptions({ maxResults: 5 })).toEqual({
      maxResults: 5,
      minScore: 0,
    });
    // Math.max(1, ...) floors at 1 so consumer can't pass 0 to mean "no hits".
    expect(parseSearchOptions({ maxResults: 0 })).toEqual({
      maxResults: 1,
      minScore: 0,
    });
    expect(parseSearchOptions({ maxResults: -3 })).toEqual({
      maxResults: 1,
      minScore: 0,
    });
  });

  it("test_parseSearchOptions_honors_minScore_passthrough", () => {
    expect(parseSearchOptions({ minScore: 0.4 })).toEqual({
      maxResults: 10,
      minScore: 0.4,
    });
    expect(parseSearchOptions({ maxResults: 20, minScore: 0.7 })).toEqual({
      maxResults: 20,
      minScore: 0.7,
    });
  });

  it("test_MemorySearchHit_re_export_is_canonical_after_iter_50", () => {
    // Iter 48 had an inline-duplicate `MemorySearchHit` interface as a
    // rollup-plugin-dts treeshake workaround. Iter 50 made the public
    // re-export reachable via memory-index, so the inline mirror was
    // deleted. This test pins that `MemorySearchHit` from
    // @theokit/sdk-memory has the exact canonical readonly shape.
    expectTypeOf<MemorySearchHit>().toMatchTypeOf<{
      readonly path: string;
      readonly startLine: number;
      readonly endLine: number;
      readonly score: number;
      readonly textScore: number;
    }>();
  });

  it("test_consumer_can_implement_MemoryIndex_minimal", () => {
    // Structural check: a consumer can declare a const matching the
    // interface without TS errors.
    const idx: MemoryIndex = {
      sync: async () => ({
        filesScanned: 1,
        filesUpdated: 0,
        chunksWritten: 0,
        chunksEmbedded: 0,
      }),
      search: async () => [],
      status: () => ({
        backend: "sqlite-vec" as const,
        files: 0,
        chunks: 0,
        embedded: 0,
      } as IndexStatus),
      close: () => {
        /* no-op */
      },
    };
    expect(typeof idx.sync).toBe("function");
    expect(typeof idx.search).toBe("function");
  });
});
