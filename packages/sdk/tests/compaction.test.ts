import { describe, expect, it } from "vitest";

import {
  buildCheckpoint,
  CHECKPOINT_MARKER,
  type CompressibleMessage,
  compactTranscript,
  filterFromLatestCheckpoint,
  isContextOverflowError,
} from "../src/compaction.js";
import { RateLimitError, TheokitAgentError } from "../src/errors.js";

/**
 * M2-1 — public compaction / context-management helpers. Design: blueprint
 * m2-compaction-public-api ADRs D1-D5. compactTranscript reuses the internal
 * selectCompressionWindow; checkpoint is a string sentinel; isContextOverflowError
 * reads the typed `context_too_long` code.
 */

const msg = (role: CompressibleMessage["role"], content: string): CompressibleMessage => ({
  role,
  content,
});

describe("isContextOverflowError (M2-1)", () => {
  it("test_isContextOverflowError_true_on_code", () => {
    expect(isContextOverflowError(new TheokitAgentError("x", { code: "context_too_long" }))).toBe(
      true,
    );
  });

  it("test_isContextOverflowError_true_on_metadata_code", () => {
    const err = new TheokitAgentError("x", {
      metadata: { provider: "anthropic", endpoint: "/v1/messages", code: "context_too_long" },
    });
    expect(isContextOverflowError(err)).toBe(true);
  });

  it("test_isContextOverflowError_false_other_code", () => {
    expect(isContextOverflowError(new TheokitAgentError("x", { code: "rate_limited" }))).toBe(
      false,
    );
  });

  it("test_isContextOverflowError_false_non_error", () => {
    expect(isContextOverflowError(new Error("context_too_long"))).toBe(false);
    expect(isContextOverflowError("context_too_long")).toBe(false);
    expect(isContextOverflowError(undefined)).toBe(false);
  });

  it("test_isContextOverflowError_true_on_subclass", () => {
    // A TheokitAgentError SUBCLASS carrying the code is still detected (instanceof base).
    const err = new RateLimitError("x", { code: "context_too_long" });
    expect(isContextOverflowError(err)).toBe(true);
  });
});

describe("checkpoint helpers (M2-1)", () => {
  it("test_buildCheckpoint_starts_with_marker", () => {
    expect(buildCheckpoint("phase-1").content.startsWith(CHECKPOINT_MARKER)).toBe(true);
  });

  it("test_filterFromLatestCheckpoint_returns_after_latest", () => {
    const out = filterFromLatestCheckpoint([
      msg("user", "a"),
      buildCheckpoint(),
      msg("assistant", "b"),
      buildCheckpoint(),
      msg("user", "c"),
    ]);
    expect(out.map((m) => m.content)).toEqual(["c"]);
  });

  it("test_filterFromLatestCheckpoint_no_marker_returns_all", () => {
    const input = [msg("user", "a"), msg("assistant", "b")];
    expect(filterFromLatestCheckpoint(input).map((m) => m.content)).toEqual(["a", "b"]);
  });

  it("test_filterFromLatestCheckpoint_does_not_mutate", () => {
    const input = [msg("user", "a"), buildCheckpoint(), msg("user", "b")];
    const snapshot = JSON.stringify(input);
    filterFromLatestCheckpoint(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("test_filterFromLatestCheckpoint_marker_last_returns_empty", () => {
    expect(filterFromLatestCheckpoint([msg("user", "a"), buildCheckpoint()])).toEqual([]);
  });
});

describe("compactTranscript (M2-1)", () => {
  const convo = (n: number): CompressibleMessage[] =>
    Array.from({ length: n }, (_, i) => msg(i % 2 === 0 ? "user" : "assistant", `m${i}`));

  it("test_compactTranscript_keeps_last_keepRecent", async () => {
    const out = await compactTranscript(convo(10), { keepRecent: 3 });
    expect(out.slice(-3).map((m) => m.content)).toEqual(["m7", "m8", "m9"]);
  });

  it("test_compactTranscript_preserves_system", async () => {
    const out = await compactTranscript([msg("system", "sys"), ...convo(10)], { keepRecent: 2 });
    expect(out[0]).toEqual(msg("system", "sys"));
  });

  it("test_compactTranscript_summarize_prepends_summary", async () => {
    const out = await compactTranscript(convo(10), {
      keepRecent: 2,
      summarize: async () => msg("assistant", "SUMMARY"),
    });
    expect(out.map((m) => m.content)).toEqual(["SUMMARY", "m8", "m9"]);
  });

  it("test_compactTranscript_no_summarize_drops_older", async () => {
    const out = await compactTranscript(convo(10), { keepRecent: 2 });
    expect(out.map((m) => m.content)).toEqual(["m8", "m9"]);
  });

  it("test_compactTranscript_shorter_than_keepRecent_noop", async () => {
    const input = convo(2);
    const out = await compactTranscript(input, { keepRecent: 6 });
    expect(out.map((m) => m.content)).toEqual(["m0", "m1"]);
  });

  it("test_compactTranscript_does_not_mutate_input", async () => {
    const input = convo(10);
    const snapshot = JSON.stringify(input);
    await compactTranscript(input, { keepRecent: 2 });
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("test_compactTranscript_default_keepRecent_6", async () => {
    const out = await compactTranscript(convo(10));
    expect(out.map((m) => m.content)).toEqual(["m4", "m5", "m6", "m7", "m8", "m9"]);
  });

  it("test_compactTranscript_empty_returns_empty", async () => {
    expect(await compactTranscript([])).toEqual([]);
  });

  it("test_compactTranscript_only_system_unchanged", async () => {
    const input = [msg("system", "a"), msg("system", "b")];
    expect(await compactTranscript(input, { keepRecent: 1 })).toEqual(input);
  });
});
