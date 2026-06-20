import { describe, expect, it } from "vitest";
import type { ReplayHistoryOptions } from "../src/index.js";
import { buildReplayHistory } from "../src/index.js";
import type { SDKMessage } from "../src/types/messages.js";

/**
 * M1-3 wiring test (T2.1) — proves buildReplayHistory is reachable through the
 * public `@theokit/sdk` barrel (the consumer-facing surface, like the M0
 * primitives) and works end-to-end on a realistic event stream. This crosses
 * the public boundary the unit test bypasses (it imports from the internal path).
 */

const RUN = { agent_id: "agent-x", run_id: "run-1" };

describe("buildReplayHistory wiring (M1-3)", () => {
  it("test_buildReplayHistory_is_exported_from_barrel", () => {
    expect(typeof buildReplayHistory).toBe("function");
  });

  it("test_rebuilds_bounded_history_from_realistic_event_stream", () => {
    const base = [{ role: "user" as const, content: "Refactor the parser and run the tests" }];
    const events: SDKMessage[] = [
      {
        type: "assistant",
        ...RUN,
        message: { role: "assistant", content: [{ type: "text", text: "Reading the parser." }] },
      },
      {
        type: "tool_call",
        ...RUN,
        call_id: "c1",
        name: "read_file",
        status: "running",
        args: { path: "parser.ts" },
      },
      {
        type: "tool_call",
        ...RUN,
        call_id: "c1",
        name: "read_file",
        status: "completed",
        result: "export function parse() {}",
      },
      {
        type: "assistant",
        ...RUN,
        message: { role: "assistant", content: [{ type: "text", text: "Now editing." }] },
      },
    ];
    const opts: ReplayHistoryOptions = { contextWindowTokens: 100_000 };

    const out = buildReplayHistory(base, events, opts);

    expect(out.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "tool_call",
      "tool_result",
      "assistant",
    ]);
    // tool-result CONTENT (working memory) is carried, not just the call
    expect(out.find((m) => m.role === "tool_result")?.content).toContain("export function parse()");
    // inputs unmutated (pure)
    expect(base.length).toBe(1);
    expect(events.length).toBe(4);
  });
});
