/**
 * sdk-memory `active-memory-types` export smoke test (iter 48).
 *
 * Validates the iter 48 hybrid copy of `internal/memory/active-memory-types.ts`
 * from sdk-core. sdk-memory now ships the canonical type-leaf that
 * `active-memory.ts` + `active-memory-cache.ts` will target when those
 * implementation files move (Stage 3 source-move continues).
 *
 * sdk-core retains its copy for v1.x active-memory back-compat.
 * Both copies are byte-identical today; semver-major reconciliation
 * happens when Stage 3 source-move completes.
 *
 * **Iter 48 dts workaround note:** the file inlines a duplicate
 * `MemorySearchHit` interface because rollup-plugin-dts treeshakes
 * the canonical declaration out of sdk-memory's dist emit (it has
 * no public reachable consumer yet). The duplicate is byte-identical
 * to the canonical shape and MUST be deleted + the import restored
 * the moment `MemorySearchHit` gains a reachable downstream consumer.
 */

import type {
  ActiveMemoryQueryMode,
  ActiveMemoryResult,
  ActiveMemoryStatus,
} from "@theokit/sdk-memory";
import { describe, expect, expectTypeOf, it } from "vitest";

describe("sdk-memory active-memory-types (iter 48)", () => {
  it("test_ActiveMemoryQueryMode_union_pinned", () => {
    expectTypeOf<ActiveMemoryQueryMode>().toEqualTypeOf<"message" | "recent" | "full">();
  });

  it("test_ActiveMemoryStatus_union_pinned", () => {
    expectTypeOf<ActiveMemoryStatus>().toEqualTypeOf<
      "ok" | "timeout" | "skipped" | "no-recall" | "error"
    >();
  });

  it("test_ActiveMemoryResult_shape_pinned", () => {
    expectTypeOf<ActiveMemoryResult>().toMatchTypeOf<{
      summary: string | undefined;
      durationMs: number;
      status: ActiveMemoryStatus;
      hits: ReadonlyArray<{
        readonly path: string;
        readonly startLine: number;
        readonly endLine: number;
        readonly score: number;
        readonly textScore: number;
      }>;
    }>();
  });

  it("test_consumer_can_construct_ActiveMemoryResult_ok", () => {
    const ok: ActiveMemoryResult = {
      summary: "recalled 1 hit",
      durationMs: 12,
      status: "ok",
      hits: [
        {
          path: "/abs/path/file.md",
          startLine: 1,
          endLine: 5,
          score: 0.87,
          textScore: 0.42,
        },
      ],
    };
    expect(ok.status).toBe("ok");
    expect(ok.hits.length).toBe(1);
  });

  it("test_consumer_can_construct_ActiveMemoryResult_skipped", () => {
    const skipped: ActiveMemoryResult = {
      summary: undefined,
      durationMs: 0,
      status: "skipped",
      hits: [],
    };
    expect(skipped.status).toBe("skipped");
    expect(skipped.summary).toBeUndefined();
  });
});
