import { describe, expect, it } from "vitest";

import {
  buildCheckpoint,
  CHECKPOINT_MARKER,
  type CompressibleMessage,
  compactTranscript,
  estimateTokens,
  filterFromLatestCheckpoint,
  isContextOverflowError,
  SUMMARY_TEMPLATE,
  shouldCompact,
} from "../src/compaction.js";
import { RateLimitError, TheokitAgentError } from "../src/errors.js";
import { setDiagnosticsSink } from "../src/internal/diagnostics.js";

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

  it("test_compactTranscript_drops_old_checkpoint_marker_keeps_system_prompt", async () => {
    // A checkpoint marker is NOT a system prompt: in the older window it is
    // dropped (no summarize); the real system prompt is always preserved.
    const input = [msg("system", "sys"), buildCheckpoint("old"), ...convo(10)];
    const out = await compactTranscript(input, { keepRecent: 2 });
    expect(out.some((m) => m.content.startsWith(CHECKPOINT_MARKER))).toBe(false);
    expect(out[0]).toEqual(msg("system", "sys"));
    expect(out.at(-1)?.content).toBe("m9");
  });

  it("test_compactTranscript_keeps_recent_checkpoint_marker", async () => {
    // A checkpoint marker inside the kept-recent window survives.
    const input = [...convo(4), buildCheckpoint("recent"), msg("user", "last")];
    const out = await compactTranscript(input, { keepRecent: 2 });
    expect(out.some((m) => m.content.startsWith(CHECKPOINT_MARKER))).toBe(true);
    expect(out.at(-1)?.content).toBe("last");
  });
});

describe("compactTranscript token-budget mode (V3-3 — keepTokens)", () => {
  // Each message ~100 tokens (400 chars) so keepTokens math is predictable.
  const big = (id: string): CompressibleMessage => msg("user", `${id}:${"x".repeat(400)}`);

  it("test_compactTranscript_token_budget_keeps_recent_within_keepTokens", async () => {
    // 4 msgs ~100 tok each; keepTokens=250 → ~2 recent (tail), head dropped (no summarize).
    const input = [big("a"), big("b"), big("c"), big("d")];
    const out = await compactTranscript(input, { keepTokens: 250 });
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(input.length);
    expect(out.at(-1)).toEqual(input.at(-1)); // recent is the TAIL
  });

  it("test_compactTranscript_token_budget_drops_head_when_no_summarize", async () => {
    const input = [big("a"), big("b"), big("c"), big("d")];
    const out = await compactTranscript(input, { keepTokens: 250 });
    // No summarize → head is dropped, only the recent tail remains.
    expect(out.every((m) => m.content.startsWith("c") || m.content.startsWith("d"))).toBe(true);
  });

  it("test_compactTranscript_token_budget_summarize_prepends", async () => {
    const input = [big("a"), big("b"), big("c"), big("d")];
    const out = await compactTranscript(input, {
      keepTokens: 250,
      summarize: async () => msg("system", "SUM"),
    });
    expect(out[0]).toEqual(msg("system", "SUM"));
    expect(out.at(-1)).toEqual(input.at(-1));
  });

  it("test_compactTranscript_token_budget_noop_when_under_budget", async () => {
    const input = [big("a"), big("b")];
    const out = await compactTranscript(input, { keepTokens: 8000 });
    expect(out).toEqual(input); // far under budget → nothing to compact
  });

  it("test_compactTranscript_keepTokens_wins_over_keepRecent", async () => {
    // Both set: token-budget path taken; keepRecent ignored (ADR D1).
    const input = [big("a"), big("b"), big("c"), big("d")];
    const out = await compactTranscript(input, { keepTokens: 250, keepRecent: 4 });
    // keepRecent=4 would keep all 4; keepTokens=250 keeps fewer → proves keepTokens wins.
    expect(out.length).toBeLessThan(input.length);
  });

  it("test_compactTranscript_token_budget_zero_keepTokens_keeps_one_recent", async () => {
    const input = [big("a"), big("b"), big("c")];
    const out = await compactTranscript(input, { keepTokens: 0 });
    expect(out).toHaveLength(1); // always ≥1 recent (Q3)
    expect(out[0]).toEqual(input.at(-1));
    // negative behaves identically
    const outNeg = await compactTranscript(input, { keepTokens: -5 });
    expect(outNeg).toHaveLength(1);
  });

  it("test_compactTranscript_token_budget_does_not_mutate_input", async () => {
    const input = [big("a"), big("b"), big("c")];
    const snapshot = JSON.stringify(input);
    await compactTranscript(input, { keepTokens: 100 });
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("test_compactTranscript_token_budget_no_system_special_casing", async () => {
    // D6: token-budget mode does NOT preserve leading system prompts separately.
    const input = [msg("system", "sys"), big("a"), big("b"), big("c")];
    const out = await compactTranscript(input, { keepTokens: 150 });
    // The old system prompt falls into the head and is dropped (no summarize) —
    // unlike keepRecent mode which always preserves it.
    expect(out.some((m) => m.content === "sys")).toBe(false);
  });
});

describe("compactTranscript configurable marker (V3-3 — D2)", () => {
  const THEO = "<conversation-checkpoint>";

  it("test_buildCheckpoint_custom_marker", () => {
    expect(buildCheckpoint("s", THEO).content.startsWith(THEO)).toBe(true);
  });

  it("test_buildCheckpoint_default_marker_unchanged", () => {
    expect(buildCheckpoint("s").content.startsWith(CHECKPOINT_MARKER)).toBe(true);
  });

  it("test_buildCheckpoint_rejects_empty_marker", () => {
    expect(() => buildCheckpoint("s", "")).toThrow(TheokitAgentError);
  });

  it("test_filterFromLatestCheckpoint_custom_marker", () => {
    const out = filterFromLatestCheckpoint(
      [msg("user", "a"), buildCheckpoint("c", THEO), msg("user", "b")],
      { marker: THEO },
    );
    expect(out.map((m) => m.content)).toEqual(["b"]);
  });

  it("test_compactTranscript_custom_marker_not_treated_as_system", async () => {
    // A <conversation-checkpoint> turn in the older window must be dropped, not
    // preserved as a leading system prompt.
    const convo = Array.from({ length: 8 }, (_, i) => msg("user", `m${i}`));
    const input = [buildCheckpoint("old", THEO), ...convo];
    const out = await compactTranscript(input, { keepRecent: 2, marker: THEO });
    expect(out.some((m) => m.content.startsWith(THEO))).toBe(false);
  });
});

describe("filterFromLatestCheckpoint include semantic (V3-3 — D5)", () => {
  it("test_filterFromLatestCheckpoint_include_from_keeps_checkpoint", () => {
    const cp = buildCheckpoint("SUMMARY");
    const out = filterFromLatestCheckpoint([msg("user", "a"), cp, msg("user", "b")], {
      include: "from",
    });
    expect(out[0]).toEqual(cp); // checkpoint included
    expect(out.at(-1)?.content).toBe("b");
  });

  it("test_filterFromLatestCheckpoint_default_after_unchanged", () => {
    const out = filterFromLatestCheckpoint([msg("user", "a"), buildCheckpoint(), msg("user", "b")]);
    expect(out.map((m) => m.content)).toEqual(["b"]); // turns AFTER (M2 default)
  });
});

describe("compactTranscript template + fail-safe (V3-3 — D3/D4)", () => {
  const convo = Array.from({ length: 8 }, (_, i) => msg("user", `m${i}`));

  it("test_summary_template_has_seven_sections", () => {
    for (const h of ["Goal", "Constraints", "Progress", "Decisions", "Next", "Critical", "Files"]) {
      expect(SUMMARY_TEMPLATE).toContain(`## ${h}`);
    }
  });

  it("test_compactTranscript_passes_template_to_summarize", async () => {
    let received = "";
    await compactTranscript(convo, {
      keepRecent: 2,
      summarize: async (_older, template) => {
        received = template;
        return msg("system", "S");
      },
    });
    expect(received).toBe(SUMMARY_TEMPLATE);
  });

  it("test_compactTranscript_custom_summaryTemplate_passed", async () => {
    let received = "";
    await compactTranscript(convo, {
      keepRecent: 2,
      summaryTemplate: "CUSTOM",
      summarize: async (_older, template) => {
        received = template;
        return msg("system", "S");
      },
    });
    expect(received).toBe("CUSTOM");
  });

  it("test_compactTranscript_one_param_summarize_still_works", async () => {
    // A 1-arg callback (M2 shape, ignores template) still compiles + runs.
    const oneArg = async (_older: CompressibleMessage[]) => msg("system", "S1");
    const out = await compactTranscript(convo, { keepRecent: 2, summarize: oneArg });
    expect(out[0]).toEqual(msg("system", "S1"));
  });

  it("test_compactTranscript_default_propagates_on_throw", async () => {
    await expect(
      compactTranscript(convo, {
        keepRecent: 2,
        summarize: async () => {
          throw new Error("boom");
        },
      }),
    ).rejects.toThrow("boom");
  });

  it("test_compactTranscript_failSafe_returns_original_on_throw", async () => {
    const out = await compactTranscript(convo, {
      keepRecent: 2,
      failSafe: true,
      summarize: async () => {
        throw new Error("boom");
      },
    });
    expect(out).toEqual(convo); // original returned unchanged
  });

  it("test_compactTranscript_failSafe_warns_on_throw", async () => {
    // theokit#147 — the warning moved from `console.warn` onto the interceptable diagnostics
    // channel, so a TUI host can route it instead of having it smeared across its frame. Asserting
    // on the sink is the stronger check: it proves the message reaches the channel a host reads,
    // not merely that something reached the terminal.
    const emitted: string[] = [];
    setDiagnosticsSink((m) => emitted.push(m));
    await compactTranscript(convo, {
      keepRecent: 2,
      failSafe: true,
      summarize: async () => {
        throw new Error("boom");
      },
    });
    expect(emitted.join("")).toContain("[compaction]");
    setDiagnosticsSink(undefined);
  });

  it("test_compactTranscript_failSafe_handles_non_error_throw", async () => {
    const emitted: string[] = [];
    setDiagnosticsSink((m) => emitted.push(m));
    const out = await compactTranscript(convo, {
      keepRecent: 2,
      failSafe: true,
      summarize: async () => {
        // deliberately throwing a non-Error value (EC-4)
        return Promise.reject("string-failure");
      },
    });
    expect(out).toEqual(convo);
    expect(emitted.join("")).toContain("string-failure");
    setDiagnosticsSink(undefined);
  });
});

describe("estimateTokens + shouldCompact (M2-2 pre-call helpers)", () => {
  it("test_estimate_tokens_chars_over_4", () => {
    expect(estimateTokens("12345678")).toBe(2);
    expect(estimateTokens("123")).toBe(1);
  });

  it("test_estimate_tokens_empty_is_zero", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("test_estimate_tokens_nonempty_min_one", () => {
    expect(estimateTokens(" ")).toBe(1);
    expect(estimateTokens("ab")).toBe(1);
  });

  it("test_should_compact_true_at_threshold", () => {
    expect(shouldCompact({ estimated: 9000, contextWindow: 10_000, buffer: 1000 })).toBe(true);
  });

  it("test_should_compact_false_with_headroom", () => {
    expect(shouldCompact({ estimated: 5000, contextWindow: 10_000, buffer: 1000 })).toBe(false);
  });

  it("test_should_compact_true_over_window", () => {
    expect(shouldCompact({ estimated: 11_000, contextWindow: 10_000, buffer: 1000 })).toBe(true);
  });

  it("test_should_compact_buffer_ge_window_always_true", () => {
    expect(shouldCompact({ estimated: 0, contextWindow: 1000, buffer: 1000 })).toBe(true);
  });

  it("test_should_compact_max_output_tightens_budget", () => {
    // Without maxOutput: 100 >= 200 - 50 = 150 -> false
    expect(shouldCompact({ estimated: 100, contextWindow: 200, buffer: 50 })).toBe(false);
    // With maxOutput 60: 100 >= 200 - 50 - 60 = 90 -> true
    expect(shouldCompact({ estimated: 100, contextWindow: 200, buffer: 50, maxOutput: 60 })).toBe(
      true,
    );
  });

  it("test_should_compact_omitted_max_output_matches_legacy", () => {
    const input = { estimated: 5000, contextWindow: 10_000, buffer: 1000 };
    expect(shouldCompact(input)).toBe(shouldCompact({ ...input }));
    expect(shouldCompact(input)).toBe(false);
  });

  it("test_should_compact_max_output_zero_equals_omitted", () => {
    expect(shouldCompact({ estimated: 100, contextWindow: 200, buffer: 50, maxOutput: 0 })).toBe(
      shouldCompact({ estimated: 100, contextWindow: 200, buffer: 50 }),
    );
  });
});
