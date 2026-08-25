/**
 * usetheokit/theokit-sdk#383 — the derivation behind `prompt_cache_key`.
 *
 * The field is only worth sending if the key is stable across the rounds and turns of one session
 * AND distinct between unrelated sessions. A test that merely asserted "a key came back" would pass
 * for `Math.random()`, which is precisely the failure mode that caches nothing — so every test here
 * compares two derivations against each other rather than inspecting one in isolation.
 */
import { describe, expect, it } from "vitest";

import { derivePromptCacheKey } from "../../../src/internal/llm/prompt-cache-key.js";

describe("usetheokit/theokit-sdk#383 — derivePromptCacheKey", () => {
  it("test_same_session_id_derives_the_same_key", () => {
    const sessionId = "agent-11111111-2222-3333-4444-555555555555";

    const first = derivePromptCacheKey(sessionId);
    const second = derivePromptCacheKey(sessionId);

    expect(first, "a session must derive a key at all").toBeDefined();
    expect(second, `a second derivation from "${sessionId}" must repeat the first`).toBe(first);
  });

  it("test_different_session_ids_derive_different_keys", () => {
    const first = derivePromptCacheKey("agent-aaaaaaaa-0000-0000-0000-000000000000");
    const second = derivePromptCacheKey("agent-bbbbbbbb-0000-0000-0000-000000000000");

    expect(
      second,
      "two unrelated sessions sharing a cache key would ask the provider to match one " +
        "conversation's prefix against another's",
    ).not.toBe(first);
  });

  it("test_a_one_character_difference_still_derives_a_different_key", () => {
    const first = derivePromptCacheKey("agent-session-1");
    const second = derivePromptCacheKey("agent-session-2");

    expect(second, "neighbouring session ids must not collide after truncation").not.toBe(first);
  });

  it("test_blank_session_id_derives_no_key", () => {
    const empty = derivePromptCacheKey("");
    const blank = derivePromptCacheKey("   ");
    const absent = derivePromptCacheKey(undefined);

    // Hashing "" yields ONE constant, which every unnamed session would then share. No key beats a
    // shared one, so the guard returns nothing rather than a collision.
    expect(empty, 'an empty session id must not derive the hash of ""').toBeUndefined();
    expect(blank, "a whitespace-only session id must not derive a key either").toBeUndefined();
    expect(absent, "an absent session id must not derive a key").toBeUndefined();
  });

  it("test_key_does_not_disclose_the_session_id", () => {
    const sessionId = "acme-billing-migration";

    const key = derivePromptCacheKey(sessionId);

    expect(
      key,
      `the key travels to the provider on every request and must not carry "${sessionId}"`,
    ).not.toContain(sessionId);
    expect(key, "a caller-chosen session name must not survive into the key").not.toContain("acme");
  });

  it("test_key_shape_is_a_prefixed_32_character_hex_digest", () => {
    const key = derivePromptCacheKey("agent-shape-check");

    expect(key, `unexpected key shape: ${String(key)}`).toMatch(/^theokit-[0-9a-f]{32}$/);
  });
});
