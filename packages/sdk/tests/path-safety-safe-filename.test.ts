import { describe, expect, it } from "vitest";

import { ConfigurationError } from "../src/errors.js";
import { asMemoryRoot } from "../src/internal/memory/storage/memory-root.js";
import { sessionSummaryPath } from "../src/internal/memory/storage/session-summary-writer.js";
import { safeFilenameForId } from "../src/path-safety.js";

/**
 * M0-4 (plan m0-foundation-expose-primitives, T2.1) — `safeFilenameForId`.
 *
 * Contract (sealed by these tests):
 *   - total function: NEVER throws on a non-empty string (any opaque id is accepted)
 *   - passthrough (lowercased) when the id already matches the safe grammar
 *   - deterministic sha256 `h-<16hex>` token otherwise (collision-resistant, valid)
 *   - empty string throws (length invariant)
 *   - migrating `sanitizeRunId` does NOT change the filename for UUID runIds
 */
describe("safeFilenameForId", () => {
  it("test_safeFilenameForId_passthrough_for_uuid", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(safeFilenameForId(uuid)).toBe(uuid);
  });

  it("test_safeFilenameForId_passthrough_lowercases", () => {
    expect(safeFilenameForId("Agent-XYZ-123")).toBe("agent-xyz-123");
  });

  it("test_safeFilenameForId_hashes_id_with_at_sign", () => {
    expect(safeFilenameForId("user@example.com")).toMatch(/^h-[0-9a-f]{16}$/);
  });

  it("test_safeFilenameForId_hashes_leading_dash_and_unicode_and_slash", () => {
    expect(safeFilenameForId("-rf")).toMatch(/^h-[0-9a-f]{16}$/);
    expect(safeFilenameForId("my-agent-🤖")).toMatch(/^h-[0-9a-f]{16}$/);
    expect(safeFilenameForId("team/project")).toMatch(/^h-[0-9a-f]{16}$/);
  });

  it("test_safeFilenameForId_is_deterministic", () => {
    expect(safeFilenameForId("user@example.com")).toBe(safeFilenameForId("user@example.com"));
  });

  it("test_safeFilenameForId_is_idempotent", () => {
    const once = safeFilenameForId("user@example.com");
    expect(safeFilenameForId(once)).toBe(once);
  });

  it("test_safeFilenameForId_throws_on_empty_string", () => {
    // B-079 — was bare `.toThrow()`. `safeFilenameForId` throws `ConfigurationError`
    // with `code: "invalid_filename_id"` (src/internal/security/path-guard.ts).
    expect(() => safeFilenameForId("")).toThrow(ConfigurationError);
    expect(() => safeFilenameForId("")).toThrow(
      expect.objectContaining({ code: "invalid_filename_id" }),
    );
  });

  it("test_safeFilenameForId_hashes_when_over_maxLen", () => {
    const longButValid = "a".repeat(40);
    expect(safeFilenameForId(longButValid, { maxLen: 16 })).toMatch(/^h-[0-9a-f]{16}$/);
  });

  it("test_sessionSummary_filename_unchanged_for_uuid_runId", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    expect(sessionSummaryPath(asMemoryRoot("/tmp/proj"), uuid).endsWith(`${uuid}.md`)).toBe(true);
  });
});
