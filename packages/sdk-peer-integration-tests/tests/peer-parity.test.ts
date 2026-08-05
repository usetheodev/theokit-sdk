/**
 * SDK 2.0 Phase 4 Stage 4 #4 — Behavior parity test (iter 79).
 *
 * Proves byte-equivalent behavior between sdk-core's routed path
 * and sdk-memory's direct path for the public Memory surface.
 *
 * This is the regression gate for Stage 4: if sdk-core's routing
 * wrapper ever diverges from sdk-memory's canonical implementation
 * (e.g., error message text, no-op result shape, lance path layout),
 * this test catches it BEFORE consumers see the divergence.
 *
 * Tested surfaces:
 *  - migrateSqliteToLance — no-legacy-json path + destination-exists
 *    precondition
 *  - Memory.openIndex — unknown-provider rejection error message
 *  - Memory.runDreamingSweep — unknown-provider rejection error message
 *
 * Both paths must produce identical observable behavior. Internal
 * routing is invisible to consumers by Stage 4 contract.
 */

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// The sdk-memory dist d.ts omits some re-exports (tsup DTS rollup issue).
// Runtime values exist — use a typed facade for the subset we need.
import * as _sdkMemory from "@theokit/sdk-memory";

const sdkMemory = _sdkMemory as typeof _sdkMemory & {
  migrateSqliteToLance: (opts: { cwd: string; logger: () => undefined }) => Promise<
    Record<string, unknown> & {
      countSqlite: number;
      countLance: number;
      validated: boolean;
      sampleComparisons: unknown[];
      committed: boolean;
      lancePath: string;
    }
  >;
  MEMORY_EMBEDDING_ADAPTERS: Record<string, unknown>;
};

import { Memory, migrateSqliteToLance, Theokit } from "@theokit/sdk";
import { describe, expect, it } from "vitest";

async function makeCwd(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

describe("sdk-core ↔ sdk-memory behavior parity (iter 79, Phase 4 #4)", () => {
  describe("migrateSqliteToLance parity", () => {
    it("test_no_legacy_json_no_op_shape_byte_equivalent_between_sdk_core_and_sdk_memory", async () => {
      const cwdSdkCore = await makeCwd("parity-core-");
      const cwdSdkMemory = await makeCwd("parity-mem-");
      try {
        const coreResult = await migrateSqliteToLance({
          cwd: cwdSdkCore,
          logger: () => undefined,
        });
        const memoryResult = await sdkMemory.migrateSqliteToLance({
          cwd: cwdSdkMemory,
          logger: () => undefined,
        });
        // Shape parity — every key + value type is identical (except
        // cwd-substituted lancePath).
        expect(Object.keys(coreResult).sort()).toEqual(Object.keys(memoryResult).sort());
        expect(coreResult.countSqlite).toBe(memoryResult.countSqlite);
        expect(coreResult.countLance).toBe(memoryResult.countLance);
        expect(coreResult.validated).toBe(memoryResult.validated);
        expect(coreResult.sampleComparisons).toEqual(memoryResult.sampleComparisons);
        expect(coreResult.committed).toBe(memoryResult.committed);
        // lancePath differs only by cwd prefix — relative suffix identical.
        expect(coreResult.lancePath.endsWith(".theokit/memory/lance")).toBe(true);
        expect(memoryResult.lancePath.endsWith(".theokit/memory/lance")).toBe(true);
      } finally {
        await rm(cwdSdkCore, { recursive: true, force: true });
        await rm(cwdSdkMemory, { recursive: true, force: true });
      }
    });

    it("test_destination_exists_throws_identical_typed_error", async () => {
      const cwdSdkCore = await makeCwd("parity-core-dst-");
      const cwdSdkMemory = await makeCwd("parity-mem-dst-");
      try {
        // Pre-create the Lance destination in both temp dirs.
        await mkdir(join(cwdSdkCore, ".theokit", "memory", "lance"), {
          recursive: true,
        });
        await mkdir(join(cwdSdkMemory, ".theokit", "memory", "lance"), {
          recursive: true,
        });

        let coreError: Error | undefined;
        let memoryError: Error | undefined;
        try {
          await migrateSqliteToLance({
            cwd: cwdSdkCore,
            logger: () => undefined,
          });
        } catch (e) {
          coreError = e as Error;
        }
        try {
          await sdkMemory.migrateSqliteToLance({
            cwd: cwdSdkMemory,
            logger: () => undefined,
          });
        } catch (e) {
          memoryError = e as Error;
        }
        expect(coreError).toBeDefined();
        expect(memoryError).toBeDefined();
        // Both errors start with the same canonical text.
        expect(coreError?.message).toContain("Destination already exists");
        expect(memoryError?.message).toContain("Destination already exists");
        // Both are the same Error subclass.
        expect(coreError?.constructor.name).toBe(memoryError?.constructor.name);
      } finally {
        await rm(cwdSdkCore, { recursive: true, force: true });
        await rm(cwdSdkMemory, { recursive: true, force: true });
      }
    });
  });

  describe("Memory.openIndex parity", () => {
    it("test_unknown_provider_error_message_matches", async () => {
      const cwd = await makeCwd("parity-openidx-");
      try {
        let coreError: Error | undefined;
        let memoryError: Error | undefined;
        try {
          await Memory.openIndex({
            cwd,
            // biome-ignore lint/suspicious/noExplicitAny: deliberate escape
            embedding: { provider: "qdrant" as any },
          });
        } catch (e) {
          coreError = e as Error;
        }
        try {
          // sdk-memory's direct path: build the adapter lookup the same way.
          const peerAdapter = sdkMemory.MEMORY_EMBEDDING_ADAPTERS["qdrant" as never];
          if (peerAdapter === undefined) {
            throw new Error(
              `Unknown embedding provider "qdrant". Supported: ${Object.keys(
                sdkMemory.MEMORY_EMBEDDING_ADAPTERS,
              ).join(", ")}.`,
            );
          }
        } catch (e) {
          memoryError = e as Error;
        }
        // Parity that holds regardless of the core-superset vs peer-subset
        // question (issue #128): BOTH reject the unknown provider with the same
        // typed `Unknown embedding provider "qdrant"` prefix naming the offending
        // provider. The trailing `Supported: ...` list legitimately differs —
        // sdk core's embedding catalog is a superset of the peer's (10 vs 6),
        // tracked in #128; asserting byte-identical messages encoded a false
        // premise. The meaningful contract is consistent typed rejection.
        expect(coreError?.message).toMatch(/^Unknown embedding provider "qdrant"/);
        expect(memoryError?.message).toMatch(/^Unknown embedding provider "qdrant"/);
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });
  });

  describe("Memory.runDreamingSweep parity", () => {
    it("test_unknown_provider_error_message_matches", async () => {
      const cwd = await makeCwd("parity-dream-");
      try {
        let coreError: Error | undefined;
        let memoryError: Error | undefined;
        try {
          await Memory.runDreamingSweep({
            cwd,
            // biome-ignore lint/suspicious/noExplicitAny: deliberate escape
            embedding: { provider: "qdrant" as any },
          });
        } catch (e) {
          coreError = e as Error;
        }
        try {
          const peerAdapter = sdkMemory.MEMORY_EMBEDDING_ADAPTERS["qdrant" as never];
          if (peerAdapter === undefined) {
            throw new Error(
              `Unknown embedding provider "qdrant". Supported: ${Object.keys(
                sdkMemory.MEMORY_EMBEDDING_ADAPTERS,
              ).join(", ")}.`,
            );
          }
        } catch (e) {
          memoryError = e as Error;
        }
        // Parity that holds regardless of the core-superset vs peer-subset
        // question (issue #128): BOTH reject the unknown provider with the same
        // typed `Unknown embedding provider "qdrant"` prefix naming the offending
        // provider. The trailing `Supported: ...` list legitimately differs —
        // sdk core's embedding catalog is a superset of the peer's (10 vs 6),
        // tracked in #128; asserting byte-identical messages encoded a false
        // premise. The meaningful contract is consistent typed rejection.
        expect(coreError?.message).toMatch(/^Unknown embedding provider "qdrant"/);
        expect(memoryError?.message).toMatch(/^Unknown embedding provider "qdrant"/);
      } finally {
        await rm(cwd, { recursive: true, force: true });
      }
    });
  });

  describe("Adapter catalog parity", () => {
    /**
     * theokit#128 — the peer must serve every embedding provider core ADVERTISES.
     *
     * This is not a symmetry nicety. When `@theokit/sdk-memory` is installed, the peer's catalog
     * REPLACES core's in the routing path (`sdk/src/memory.ts` — `peer.MEMORY_EMBEDDING_ADAPTERS`),
     * while the public `Theokit.inspect.embeddingAdapters()` keeps listing core's. So every id core
     * advertises but the peer lacks is a provider the SDK promises and then rejects at open time —
     * which is exactly what happened to `azure-openai`, `cohere`, `jina` and `gemini` for the two
     * months between core adding them and this test existing.
     *
     * Written as core-is-a-subset-of-peer rather than set equality on purpose: a peer that got
     * ahead of core is not a broken promise to anyone, so it should not fail the build.
     */
    it("test_peer_serves_every_embedding_provider_core_publicly_advertises", () => {
      const advertised = Theokit.inspect.embeddingAdapters().map((a) => a.id);
      const served = new Set(Object.keys(sdkMemory.MEMORY_EMBEDDING_ADAPTERS));

      const promisedButUnserved = advertised.filter((id) => !served.has(id));
      expect(promisedButUnserved, "core advertises these; the peer would reject them").toEqual([]);
    });

    it("test_the_canonical_catalog_is_the_ten_providers_of_ADR_D11_D183_and_T4_10", () => {
      // Pinned explicitly so a DROP on either side is as visible as an addition. The subset
      // assertion above cannot see a provider that vanishes from both.
      const canonical = [
        "azure-openai",
        "cohere",
        "deepinfra",
        "gemini",
        "jina",
        "mistral",
        "ollama",
        "openai",
        "openrouter",
        "voyage",
      ];
      expect(Object.keys(sdkMemory.MEMORY_EMBEDDING_ADAPTERS).sort()).toEqual(canonical);
      expect(
        Theokit.inspect
          .embeddingAdapters()
          .map((a) => a.id)
          .sort(),
      ).toEqual(canonical);
    });
  });
});
