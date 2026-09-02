import { describe, expect, it } from "vitest";
import type { MemoryIndex } from "../../src/internal/memory/memory-index.js";
import type {
  MigrateOptions as InternalMigrateOptions,
  MigrateResult as InternalMigrateResult,
} from "../../src/internal/memory/migrate-sqlite-to-lance.js";
import type { MemoryIndexHandle } from "../../src/memory.js";
import type { MigrateOptions, MigrateResult } from "../../src/migrate.js";

/**
 * Three public types in `src/` structurally MIRROR an internal contract instead of re-exporting it.
 * The mirrors are deliberate and the reason is documented: re-exporting from `internal/` would pull
 * that subtree into the DTS rollup, which `rollup-plugin-dts` cannot resolve. Deleting them is not
 * the fix.
 *
 * The cost is that the two copies can drift, and `src/index.ts:207-215` records what that costs —
 * `@theokit/sdk-memory` had inlined mirrors of two telemetry types, they drifted, and the note there
 * calls a mirror "a stopgap and not a design". Inside this package the gap is bridged by `as any`
 * casts behind biome suppressions, so drift would surface at RUN time, in a consumer.
 *
 * These assertions make it surface at COMPILE time instead. They are type-level and assign nothing
 * at runtime; the `expect` exists so the file is a test rather than a silently-skipped module.
 *
 * Both directions are checked deliberately. One direction alone catches a field ADDED to the
 * internal type and misses a field added to the public one, which is the direction that ships a
 * promise the implementation does not keep.
 */
describe("public mirrors match the internal contract they mirror", () => {
  /**
   * ONE direction here, unlike the two below, and the asymmetry is deliberate rather than a
   * weakening. `MemoryIndexHandle.search` returns `ReadonlyArray<...>` where `MemoryIndex.search`
   * returns a mutable array — the public facade is deliberately STRICTER, which is right for a type
   * a consumer receives and never populates. Demanding mutual assignability would force the public
   * surface to hand out a mutable array to satisfy a test.
   *
   * The direction asserted is the one that matters: an internal index must be usable AS the handle,
   * because `openIndex` casts one to the other at src/memory.ts:196. It catches the failure that
   * ships — the public type promising a member the implementation does not have.
   */
  it("an internal MemoryIndex satisfies the public MemoryIndexHandle", () => {
    const _publicFromInternal: MemoryIndexHandle = {} as MemoryIndex;
    void _publicFromInternal;
    expect(true).toBe(true);
  });

  it("MigrateOptions matches its internal twin, both ways", () => {
    const _publicFromInternal: MigrateOptions = {} as InternalMigrateOptions;
    const _internalFromPublic: InternalMigrateOptions = {} as MigrateOptions;
    void _publicFromInternal;
    void _internalFromPublic;
    expect(true).toBe(true);
  });

  it("MigrateResult matches its internal twin, both ways", () => {
    const _publicFromInternal: MigrateResult = {} as InternalMigrateResult;
    const _internalFromPublic: InternalMigrateResult = {} as MigrateResult;
    void _publicFromInternal;
    void _internalFromPublic;
    expect(true).toBe(true);
  });
});
