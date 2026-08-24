/**
 * sdk-memory `index-manager-dispatch` unit test (iter 70).
 *
 * Validates the iter 70 hybrid copy of
 * `internal/memory/index-manager-dispatch.ts` from sdk-core.
 * sdk-memory now ships the canonical backend dispatch helpers used
 * by IndexManager.open to route between sqlite-vec (default) and
 * lance backends.
 *
 * sdk-core retains its copy for v1.x back-compat.
 * Both copies byte-equivalent at runtime (same VALID_BACKENDS
 * array, same `invalid_memory_backend` typed error message text,
 * same `lance_requires_embedding` precondition guard before
 * touching LanceIndex.open).
 *
 * `assertValidBackend` runs pure (no external deps).
 * `openLanceIndex` exercises the `lance_requires_embedding`
 * precondition path WITHOUT needing @lancedb/lancedb installed —
 * the embedding=undefined branch throws before touching the
 * native module.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertValidBackend,
  isLanceAvailable,
  openLanceIndex,
  VALID_BACKENDS,
} from "@theokit/sdk-memory";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("sdk-memory index-manager-dispatch (iter 70)", () => {
  describe("VALID_BACKENDS + assertValidBackend (EC-1)", () => {
    it("test_VALID_BACKENDS_pinned_to_sqlite_vec_and_lance", () => {
      expect(VALID_BACKENDS).toEqual(["sqlite-vec", "lance"]);
    });

    it("test_assertValidBackend_passes_for_sqlite_vec", () => {
      expect(() => assertValidBackend("sqlite-vec")).not.toThrow();
    });

    it("test_assertValidBackend_passes_for_lance", () => {
      expect(() => assertValidBackend("lance")).not.toThrow();
    });

    it("test_assertValidBackend_throws_typed_ConfigurationError_for_unknown", () => {
      // EC-1: TS union is compile-time only — runtime guard MUST catch
      // any `as any` typo at consumer boundary so silent SQLite fallback
      // is impossible.
      expect(() => assertValidBackend("postgres-vector")).toThrowError(
        /Invalid memory backend "postgres-vector"/,
      );
      expect(() => assertValidBackend("")).toThrowError(/Invalid memory backend ""/);
      expect(() => assertValidBackend("SQLITE-VEC")).toThrowError(
        /Invalid memory backend "SQLITE-VEC"/,
      );
    });
  });

  describe("openLanceIndex precondition path", () => {
    let cwd: string;

    beforeEach(async () => {
      cwd = await mkdtemp(join(tmpdir(), "sdk-memory-dispatch-"));
    });
    afterEach(async () => {
      await rm(cwd, { recursive: true, force: true });
    });

    it("test_openLanceIndex_throws_lance_requires_embedding_when_undefined", async () => {
      // Lance has no FTS fallback — embedding is mandatory. This branch
      // fires BEFORE LanceIndex.open even tries to dynamic-require
      // @lancedb/lancedb, so this test runs reliably even on environments
      // without the optional peer installed.
      await expect(openLanceIndex({ cwd })).rejects.toMatchObject({
        message: expect.stringContaining("Lance backend requires an embedding runtime"),
      });
    });

    // Only meaningful when the optional peer is ABSENT. When it is installed the runner must
    // report SKIPPED — a bare `return` here reported PASS for an assertion that never ran.
    it.skipIf(isLanceAvailable())(
      "test_openLanceIndex_propagates_lance_backend_unavailable_when_peer_missing",
      async () => {
        const stubEmbedding = {
          embed: async () => [],
          dimension: 3,
          providerId: "stub",
          model: "stub",
        } as never;
        await expect(openLanceIndex({ cwd, embedding: stubEmbedding })).rejects.toMatchObject({
          message: expect.stringContaining("`@lancedb/lancedb` is not installed"),
        });
      },
    );
  });
});
