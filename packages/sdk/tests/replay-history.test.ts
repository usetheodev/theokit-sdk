import { describe, expect, it } from "vitest";

import { buildReplayHistory } from "../src/internal/runtime/context/replay-history.js";
import type { StoredMessage } from "../src/types/conversation-storage.js";
import type { SDKMessage } from "../src/types/messages.js";

/**
 * M1-3 — pure stateless continuation-history rebuild (plan m1-continuation-history).
 *
 * `buildReplayHistory(base, events, opts)` serializes SDKMessage[] stream events
 * into a bounded StoredMessage[] replay history for the stateless continuation
 * path (a fresh agent per round). Pure, sync, deterministic — driven entirely by
 * hand-built inputs, no LLM. Design: blueprint m1-continuation-history ADRs D1-D5.
 */

const RUN = { agent_id: "agent-x", run_id: "run-1" };

function assistant(text: string): SDKMessage {
  return {
    type: "assistant",
    ...RUN,
    message: { role: "assistant", content: [{ type: "text", text }] },
  };
}
function assistantToolOnly(name: string): SDKMessage {
  // assistant message carrying ONLY a tool_use block (no text)
  return {
    type: "assistant",
    ...RUN,
    message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name, input: {} }] },
  };
}
function toolRun(name: string, args: unknown, callId = "c1"): SDKMessage {
  return { type: "tool_call", ...RUN, call_id: callId, name, status: "running", args };
}
function toolDone(name: string, result: unknown, callId = "c1"): SDKMessage {
  return { type: "tool_call", ...RUN, call_id: callId, name, status: "completed", result };
}
function toolErr(name: string, result: unknown, callId = "c1"): SDKMessage {
  return { type: "tool_call", ...RUN, call_id: callId, name, status: "error", result };
}
function thinking(): SDKMessage {
  return { type: "thinking", ...RUN, text: "hmm" } as SDKMessage;
}
const OPTS = { contextWindowTokens: 100_000 }; // generous budget unless overridden

describe("buildReplayHistory (M1-3)", () => {
  it("test_maps_assistant_text_to_assistant_role", () => {
    const out = buildReplayHistory([], [assistant("hello")], OPTS);
    expect(out).toEqual([{ role: "assistant", content: "hello" }]);
  });

  it("test_maps_tool_running_to_tool_call_and_completed_to_tool_result", () => {
    const out = buildReplayHistory(
      [],
      [toolRun("read", { path: "a" }), toolDone("read", "file body")],
      OPTS,
    );
    expect(out.map((m) => m.role)).toEqual(["tool_call", "tool_result"]);
    expect(out[0]?.content).toContain("read");
    expect(out[1]?.content).toContain("file body");
  });

  it("test_skips_non_replayable_events", () => {
    const out = buildReplayHistory([], [thinking()], OPTS);
    expect(out).toEqual([]);
  });

  it("test_returns_base_when_no_events", () => {
    const base: StoredMessage[] = [{ role: "user", content: "do X" }];
    expect(buildReplayHistory(base, [], OPTS)).toEqual(base);
  });

  it("test_drops_oldest_until_under_budget_keeps_at_least_one", () => {
    const base: StoredMessage[] = [
      { role: "user", content: "A".repeat(40) },
      { role: "assistant", content: "B".repeat(40) },
    ];
    // budget = (20 - 0) * 4 = 80 chars; base+new = 120 > 80 → drop oldest (base[0])
    const out = buildReplayHistory(base, [assistant("C".repeat(40))], {
      contextWindowTokens: 20,
      reserveTokens: 0,
    });
    const total = out.reduce((n, m) => n + m.content.length, 0);
    expect(total).toBeLessThanOrEqual(80);
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out.at(-1)?.content).toBe("C".repeat(40)); // newest survives
    expect(out.some((m) => m.content.startsWith("A"))).toBe(false); // oldest dropped
  });

  it("test_truncates_oversized_single_turn_not_dropped", () => {
    const big = "Z".repeat(5_000);
    const out = buildReplayHistory([], [toolDone("read", big)], {
      contextWindowTokens: 1000,
      reserveTokens: 0,
    });
    expect(out.length).toBe(1); // not dropped
    expect(out[0]?.content.length).toBeLessThan(big.length); // truncated
  });

  it("test_never_splits_tool_call_from_tool_result_on_real_drop_non_adjacent", () => {
    // The call and its result are NON-ADJACENT (an assistant turn sits between them),
    // and the budget forces a REAL eviction of the oldest turns — exercising the
    // pair-drop branch (not vacuously). The c1 pair must be evicted together.
    const events = [
      toolRun("read", "x", "c1"),
      assistant("thinking between call and result"), // non-adjacent
      toolDone("read", "R".repeat(40), "c1"),
      assistant("S".repeat(40)),
    ];
    const out = buildReplayHistory([], events, { contextWindowTokens: 20, reserveTokens: 0 }); // budget 80
    const calls = out.filter((m) => m.role === "tool_call").length;
    const results = out.filter((m) => m.role === "tool_result").length;
    expect(calls).toBe(results); // no orphan despite non-adjacency
    expect(out.some((m) => m.role === "tool_call")).toBe(false); // the c1 pair was actually evicted
    const total = out.reduce((n, m) => n + m.content.length, 0);
    expect(total).toBeLessThanOrEqual(80); // a real drop happened (loop was entered)
  });

  it("test_evicts_whole_tool_pair_with_multiple_interleaved_pairs", () => {
    // Two distinct call_ids; under budget the oldest whole pair is evicted, never orphaned.
    const events = [
      toolRun("a", "1", "c1"),
      toolRun("b", "2", "c2"), // interleaved: both calls before either result
      toolDone("a", "R".repeat(40), "c1"),
      toolDone("b", "R".repeat(40), "c2"),
      assistant("S".repeat(40)),
    ];
    const out = buildReplayHistory([], events, { contextWindowTokens: 25, reserveTokens: 0 }); // budget 100
    expect(out.filter((m) => m.role === "tool_call").length).toBe(
      out.filter((m) => m.role === "tool_result").length,
    ); // calls === results after eviction — no orphan from interleaving
  });

  it("test_lone_tool_call_survives_and_is_not_paired", () => {
    // A running tool_call with no completed result (agent interrupted mid-tool).
    const out = buildReplayHistory([], [toolRun("read", {})], OPTS);
    expect(out.map((m) => m.role)).toEqual(["tool_call"]);
  });

  it("test_tool_error_status_maps_to_tool_result", () => {
    const out = buildReplayHistory([], [toolErr("read", "boom")], OPTS);
    expect(out.length).toBe(1);
    expect(out[0]?.role).toBe("tool_result");
    expect(out[0]?.content).toContain("boom");
  });

  it("test_assistant_mixed_text_and_tool_use_maps_text_only", () => {
    const event: SDKMessage = {
      type: "assistant",
      ...RUN,
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "thinking" },
          { type: "tool_use", id: "t1", name: "read", input: {} },
        ],
      },
    };
    expect(buildReplayHistory([], [event], OPTS)).toEqual([
      { role: "assistant", content: "thinking" },
    ]);
  });

  it("test_budget_zero_when_reserve_exceeds_window", () => {
    const out = buildReplayHistory([{ role: "user", content: "keep me" }], [], {
      contextWindowTokens: 100,
      reserveTokens: 999,
    });
    expect(out.length).toBe(1); // keep >= 1 even at budget 0
  });

  it("test_is_pure_does_not_mutate_inputs", () => {
    const base: StoredMessage[] = [{ role: "user", content: "x" }];
    const events = [assistant("y")];
    const baseSnap = JSON.stringify(base);
    const evSnap = JSON.stringify(events);
    buildReplayHistory(base, events, OPTS);
    expect(JSON.stringify(base)).toBe(baseSnap);
    expect(JSON.stringify(events)).toBe(evSnap);
  });

  // --- edge cases EC-1..EC-6 (edge-case review) ---

  it("test_non_finite_context_window_collapses_to_zero_budget", () => {
    // EC-1: NaN window must NOT return unbounded — budget collapses to 0, keep>=1 newest
    const out = buildReplayHistory(
      [{ role: "user", content: "a".repeat(100) }],
      [assistant("b".repeat(100))],
      { contextWindowTokens: Number.NaN },
    );
    expect(out.length).toBe(1); // bounded, not both
  });

  it("test_returns_empty_when_base_and_events_empty", () => {
    expect(buildReplayHistory([], [], OPTS)).toEqual([]); // EC-2: keep>=1 must not fabricate
  });

  it("test_skips_assistant_event_with_no_text_blocks", () => {
    expect(buildReplayHistory([], [assistantToolOnly("read")], OPTS)).toEqual([]); // EC-3
  });

  it("test_tool_result_with_undefined_result_yields_empty_content_not_string_undefined", () => {
    const out = buildReplayHistory([], [toolDone("read", undefined)], OPTS); // EC-4
    expect(out.length).toBe(1);
    expect(out[0]?.content).not.toContain("undefined");
  });

  it("test_drops_orphan_tool_result_without_crashing", () => {
    // EC-5: a tool_result whose tool_call is absent (only the result event present)
    const out = buildReplayHistory([], [toolDone("read", "orphan")], {
      contextWindowTokens: 100_000,
    });
    expect(out.every((m) => m.role !== "tool_call")).toBe(true);
    expect(Array.isArray(out)).toBe(true); // no crash
  });

  it("test_perItemCap_zero_truncates_to_empty_marker_safely", () => {
    // EC-6: perItemCap 0/negative guarded — no crash, content bounded
    const out = buildReplayHistory([], [toolDone("read", "X".repeat(100))], {
      contextWindowTokens: 100_000,
      perItemCap: 0,
    });
    expect(out.length).toBe(1);
    expect(out[0]?.content.length).toBeLessThan(100);
  });
});
