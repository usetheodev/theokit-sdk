/**
 * SDK 2.0 Phase 4 (Stage 4) — Optional peer loader for
 * `@theokit/sdk-memory`.
 *
 * The Memory class public API in `src/memory.ts` keeps its surface
 * stable but routes through sdk-memory when installed. When sdk-memory
 * is NOT installed, methods fall back to sdk-core's legacy
 * `internal/memory/*` implementations — preserving v1.x back-compat.
 *
 * Pattern mirrors sdk-handoff's optional-peer dynamic import: try
 * `await import("@theokit/sdk-memory")` once, cache the result (the
 * module OR `null` for "definitively missing"), and let the caller
 * route.
 *
 * Iter 76 (Stage 4 #1): foundation helper for the Memory class
 * delegation refactor. No behavior changes yet — this iter only
 * adds the loader; iter 77+ wires Memory class methods to use it.
 *
 * @internal
 */

/**
 * Minimal structural mirror of the sdk-memory surface this loader
 * exposes to Memory class methods. Keeps the contract pinned even
 * if sdk-memory ships additional exports.
 */
export interface SdkMemoryModule {
  /** Mirrors @theokit/sdk-memory's catalog Record. */
  readonly MEMORY_EMBEDDING_ADAPTERS: Readonly<
    Record<
      string,
      {
        readonly id: string;
        readonly defaultModel: string;
        readonly transport: "local" | "remote";
        // biome-ignore lint/suspicious/noExplicitAny: structural mirror — runtime carries the canonical types
        create(options: any): Promise<any>;
      }
    >
  >;

  /** Mirrors @theokit/sdk-memory's runDreamingSweep entrypoint. */
  runDreamingSweep(opts: {
    cwd: string;
    // biome-ignore lint/suspicious/noExplicitAny: structural mirror
    embedding: any;
    dedupThreshold?: number;
    clusterThreshold?: number;
  }): Promise<{
    status: "ok" | "skipped" | "error";
    factsBefore: number;
    factsAfter: number;
    duplicatesRemoved: number;
    clustersCreated: number;
    notesWritten: number;
  }>;

  /** Mirrors @theokit/sdk-memory's IndexManager class (static open). */
  readonly IndexManager: {
    open(opts: {
      cwd: string;
      filePath?: string;
      // biome-ignore lint/suspicious/noExplicitAny: structural mirror
      embedding?: any;
      backend?: "sqlite-vec" | "lance";
    // biome-ignore lint/suspicious/noExplicitAny: structural mirror
    }): Promise<any>;
  };

  /** Mirrors @theokit/sdk-memory's migrateSqliteToLance entrypoint (ADR D44). */
  migrateSqliteToLance(opts: {
    cwd: string;
    dryRun?: boolean;
    batchSize?: number;
    logger?: (msg: string) => void;
  }): Promise<{
    countSqlite: number;
    countLance: number;
    validated: boolean;
    sampleComparisons: ReadonlyArray<{ id: string; match: boolean }>;
    lancePath: string;
    committed: boolean;
  }>;
}

let cachedAttempt: Promise<SdkMemoryModule | null> | undefined;
let forcedAbsentForTests = false;

/**
 * Attempt to load `@theokit/sdk-memory`. Returns the module on
 * success, `null` on definitive absence. Result is memoized so
 * repeated calls during agent runtime don't re-pay the dynamic
 * import cost.
 *
 * @internal
 */
export function tryLoadSdkMemoryPeer(): Promise<SdkMemoryModule | null> {
  if (forcedAbsentForTests) return Promise.resolve(null);
  if (cachedAttempt !== undefined) return cachedAttempt;
  cachedAttempt = (async () => {
    try {
      // Dynamic specifier kept opaque so bundlers can't statically
      // resolve sdk-memory and bake it into a bundle that would
      // require the package to exist at install time.
      const spec = "@theokit/sdk-memory";
      const mod = (await import(spec)) as unknown as SdkMemoryModule;
      // Sanity: the module must expose the 4 surfaces we route through.
      if (
        typeof mod.runDreamingSweep === "function" &&
        mod.MEMORY_EMBEDDING_ADAPTERS !== undefined &&
        mod.IndexManager !== undefined &&
        typeof mod.migrateSqliteToLance === "function"
      ) {
        return mod;
      }
      return null;
    } catch {
      return null;
    }
  })();
  return cachedAttempt;
}

/**
 * Test-only: reset the memoized loader state so an integration test
 * can probe both the "peer present" and "peer absent" code paths.
 *
 * @internal
 */
export function resetSdkMemoryPeerCacheForTests(): void {
  cachedAttempt = undefined;
  forcedAbsentForTests = false;
}

/**
 * Test-only: force the loader to behave as if sdk-memory is NOT
 * installed, even when the workspace setup makes it resolvable. Lets
 * tests exercise the legacy fallback code path inside sdk-core's
 * Memory class methods + migrate wrapper without uninstalling the
 * peer.
 *
 * Pair with `resetSdkMemoryPeerCacheForTests()` in afterEach to undo.
 *
 * @internal
 */
export function forceSdkMemoryPeerAbsentForTests(): void {
  cachedAttempt = undefined;
  forcedAbsentForTests = true;
}
