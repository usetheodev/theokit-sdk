import { describe, expect, it, vi } from "vitest";

import {
  buildCheckpoint,
  type CompressibleMessage,
  compactTranscript,
  filterFromLatestCheckpoint,
  SUMMARY_TEMPLATE,
} from "../src/compaction.js";

/**
 * V3-3 parity suite — mirrors theocode's `tests/unit/compaction.test.ts` corpus
 * against the SDK's token-budget mode + `<conversation-checkpoint>` marker +
 * `failSafe:true` + `include:'from'`. Proves theocode can adopt the SDK
 * `compactTranscript` and delete its local `server/lib/compaction.ts` (anti-
 * reinvention baseline 2→1). Parity is BEHAVIORAL (split points, marker,
 * template, fail-safe, filter), not signature-identical (Q1).
 */
const MARKER = "<conversation-checkpoint>";
const msg = (role: CompressibleMessage["role"], content: string): CompressibleMessage => ({
  role,
  content,
});
// ~100 tokens each (400 chars), matching theocode's test sizing.
const big = (id: string): CompressibleMessage => msg("user", `${id}:${"x".repeat(400)}`);

describe("compaction parity with theocode (V3-3)", () => {
  it("test_compactTranscript_token_budget_parity_split_keeps_recent", async () => {
    // theocode test_splitTranscript_keeps_recent_within_keepTokens (keepTokens=250 → ~2 recent)
    const messages = [big("a"), big("b"), big("c"), big("d")];
    const out = await compactTranscript(messages, { keepTokens: 250 });
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(messages.length);
    expect(out.at(-1)).toEqual(messages.at(-1)); // recent is the TAIL
  });

  it("test_compactTranscript_token_budget_parity_replaces_head_with_checkpoint", async () => {
    // theocode test_compactTranscript_replaces_head_with_checkpoint (marker <conversation-checkpoint>)
    const messages = [big("a"), big("b"), big("c"), big("d")];
    const out = await compactTranscript(messages, {
      keepTokens: 250,
      marker: MARKER,
      // SDK buildCheckpoint returns the full system message (theocode returns a string).
      summarize: async (_head, template) => buildCheckpoint(`SUMMARY [${template.length}]`, MARKER),
    });
    expect(out[0]?.content.startsWith(MARKER)).toBe(true);
    expect(out.at(-1)).toEqual(messages.at(-1));
  });

  it("test_compactTranscript_token_budget_parity_noop_when_under_budget", async () => {
    // theocode test_compactTranscript_is_noop_when_under_keepTokens
    const messages = [big("a"), big("b")];
    const out = await compactTranscript(messages, { keepTokens: 8000, marker: MARKER });
    expect(out).toEqual(messages);
  });

  it("test_compactTranscript_token_budget_parity_failsafe_on_summarizer_error", async () => {
    // theocode test_compactTranscript_falls_back_on_summarizer_error
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const messages = [big("a"), big("b"), big("c"), big("d")];
    const out = await compactTranscript(messages, {
      keepTokens: 250,
      marker: MARKER,
      failSafe: true,
      summarize: async () => {
        throw new Error("summarizer down");
      },
    });
    expect(out).toEqual(messages); // original unchanged
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("test_compactTranscript_token_budget_parity_template_seven_sections", () => {
    // theocode test_buildCheckpoint_and_template_have_all_seven_sections
    for (const h of ["Goal", "Constraints", "Progress", "Decisions", "Next", "Critical", "Files"]) {
      expect(SUMMARY_TEMPLATE).toContain(`## ${h}`);
    }
  });

  it("test_compactTranscript_token_budget_parity_filter_from_latest_inclusive", () => {
    // theocode test_history_loading_filters_from_latest_checkpoint (checkpoint INCLUDED)
    const cp = buildCheckpoint("SUMMARY of the above", MARKER);
    const out = filterFromLatestCheckpoint(
      [
        msg("user", "old 1"),
        msg("assistant", "old 2"),
        cp,
        msg("user", "recent 1"),
        msg("assistant", "recent 2"),
      ],
      { marker: MARKER, include: "from" },
    );
    expect(out[0]).toEqual(cp); // checkpoint stands in for the pruned head
    expect(out.at(-1)?.content).toBe("recent 2");
  });

  it("test_compactTranscript_token_budget_parity_filter_all_when_no_checkpoint", () => {
    // theocode test_filterFromLatestCheckpoint_returns_all_when_no_checkpoint
    const messages = [msg("user", "a"), msg("assistant", "b")];
    expect(filterFromLatestCheckpoint(messages, { marker: MARKER, include: "from" })).toEqual(
      messages,
    );
  });
});
