import { createServer, type Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import { PermissionEngine, PermissionPlugin } from "../src/index.js";
import { emitRunEvent } from "../src/internal/emit-run-event.js";
import type { RunEvent } from "../src/types/run-events.js";
import { messageDelta, sseFrame } from "./helpers/anthropic-sse.js";
import { useTempCwd } from "./helpers/temp-workspace.js";

// Agent.create defaults its workspace to process.cwd(), which during a test run is the
// package itself — this file created agents without saying where, and the sessions landed in
// packages/sdk/.theokit/. See useTempCwd's docblock for the 540 MB that bought.
useTempCwd();

/**
 * SE2 — typed runtime event stream. The pure `emitRunEvent` is fail-safe; the
 * end-to-end wiring emits `permission_denied` when a permission plugin blocks a
 * tool and `tool_progress` when a tool dispatches, delivered opt-in via
 * `SendOptions.onRunEvent` — ADDITIVE to the `SDKMessage` content stream.
 *
 * TDD RED-first.
 */

describe("emitRunEvent (SE2) — fail-safe emitter", () => {
  it("no-ops when the sink is absent", () => {
    expect(() =>
      emitRunEvent(undefined, { type: "tool_progress", toolName: "x", toolCallId: "1" }),
    ).not.toThrow();
  });

  it("delivers the event to the sink", () => {
    const seen: RunEvent[] = [];
    emitRunEvent((e) => seen.push(e), { type: "rate_limit", attempt: 1, retryAfterMs: 500 });
    expect(seen).toEqual([{ type: "rate_limit", attempt: 1, retryAfterMs: 500 }]);
  });

  it("swallows a throwing sink (observability never breaks the run)", () => {
    expect(() =>
      emitRunEvent(
        () => {
          throw new Error("boom");
        },
        { type: "compact_boundary", trigger: "auto" },
      ),
    ).not.toThrow();
  });
});

// ── Integration: drive a real run against a stub Anthropic ────────────────────

interface Script {
  toolName: string;
}

function startStub(script: Script): Promise<{ server: Server; url: string }> {
  let call = 0;
  const server = createServer((req, res) => {
    if (req.url !== "/v1/messages") {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.statusCode = 200;
    res.setHeader("content-type", "text/event-stream");
    res.write(sseFrame("message_start", "{}"));
    call += 1;
    if (call === 1) {
      res.write(
        sseFrame(
          "content_block_start",
          JSON.stringify({
            type: "content_block_start",
            index: 0,
            content_block: { type: "tool_use", id: "tu-1", name: script.toolName, input: {} },
          }),
        ),
      );
      res.write(
        sseFrame(
          "content_block_delta",
          JSON.stringify({
            type: "content_block_delta",
            index: 0,
            delta: { type: "input_json_delta", partial_json: "{}" },
          }),
        ),
      );
      res.write(
        sseFrame("content_block_stop", JSON.stringify({ type: "content_block_stop", index: 0 })),
      );
      res.write(messageDelta("tool_use", { input_tokens: 10, output_tokens: 5 }));
    } else {
      res.write(
        sseFrame(
          "content_block_delta",
          JSON.stringify({
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "done" },
          }),
        ),
      );
      res.write(messageDelta("end_turn", { input_tokens: 20, output_tokens: 5 }));
    }
    res.write(sseFrame("message_stop", "{}"));
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const a = server.address();
      if (typeof a !== "object" || a === null) throw new Error("bind failed");
      resolve({ server, url: `http://127.0.0.1:${a.port}` });
    });
  });
}

async function drainWithEvents(opts: { toolAction: "deny" | "allow" }): Promise<RunEvent[]> {
  const { Agent } = await import("../src/index.js");
  const stub = await startStub({ toolName: "risky" });
  const prevKey = process.env.ANTHROPIC_API_KEY;
  const prevUrl = process.env.ANTHROPIC_API_BASE_URL;
  process.env.ANTHROPIC_API_KEY = "sk-stub";
  process.env.ANTHROPIC_API_BASE_URL = stub.url;
  const events: RunEvent[] = [];
  try {
    const engine = new PermissionEngine([{ tool: "risky", action: opts.toolAction }]);
    const agent = await Agent.create({
      apiKey: "real-not-fixture",
      model: { id: "claude-sonnet-4-6" },
      tools: [
        {
          name: "risky",
          description: "A tool gated by the permission plugin (SE2 test).",
          inputSchema: { type: "object", properties: {} },
          handler: () => "ok",
        },
      ],
      // The engine's rule decides deny/allow directly for "risky"; no ask branch,
      // so no canUseTool is needed for this test (a "deny" rule short-circuits).
      plugins: [PermissionPlugin.create(engine)],
    });
    const run = await agent.send("do it", { onRunEvent: (e) => events.push(e) });
    for await (const _ of run.stream()) {
      // drain
    }
  } finally {
    // Restore env WITHOUT coercing `undefined` to the string "undefined".
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevKey;
    if (prevUrl === undefined) delete process.env.ANTHROPIC_API_BASE_URL;
    else process.env.ANTHROPIC_API_BASE_URL = prevUrl;
    stub.server.close();
  }
  return events;
}

describe("RunEvent wiring (SE2) — end-to-end via onRunEvent", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => cleanup?.());

  it("emits permission_denied when a permission plugin blocks a tool", async () => {
    const events = await drainWithEvents({ toolAction: "deny" });
    const denied = events.find((e) => e.type === "permission_denied");
    expect(denied).toBeDefined();
    expect(denied).toMatchObject({
      type: "permission_denied",
      toolName: "risky",
      source: "plugin",
    });
  });

  it("emits tool_progress when a tool dispatches (allowed)", async () => {
    const events = await drainWithEvents({ toolAction: "allow" });
    const progress = events.find((e) => e.type === "tool_progress");
    expect(progress).toBeDefined();
    expect(progress).toMatchObject({ type: "tool_progress", toolName: "risky" });
  });
});

/**
 * theokit#140 — `run.events()` is ONE ordered source.
 *
 * Reuses `startStub` above rather than standing up a second fake provider: two harnesses for the
 * same runtime is two definitions of "a run", and they drift.
 *
 * What is pinned is the property that made the two-source merge necessary — that BOTH kinds arrive
 * on one iterator. Ordering itself is not asserted because it is not reconstructed: both kinds are
 * appended by the loop as they happen, so arrival order IS model order. There is no sort left to
 * test, which was the point.
 */
async function drainTimeline(): Promise<{
  timeline: import("../src/types/run.js").RunTimelineEvent[];
  streamed: string[];
  callerDeltas: number;
}> {
  const { Agent } = await import("../src/index.js");
  const stub = await startStub({ toolName: "risky" });
  const prevKey = process.env.ANTHROPIC_API_KEY;
  const prevUrl = process.env.ANTHROPIC_API_BASE_URL;
  process.env.ANTHROPIC_API_KEY = "sk-stub";
  process.env.ANTHROPIC_API_BASE_URL = stub.url;
  const timeline: import("../src/types/run.js").RunTimelineEvent[] = [];
  const streamed: string[] = [];
  let callerDeltas = 0;
  try {
    const agent = await Agent.create({
      apiKey: "real-not-fixture",
      model: { id: "claude-sonnet-4-6" },
      tools: [
        {
          name: "risky",
          description: "A tool, so the run produces tool lifecycle as well as text.",
          inputSchema: { type: "object", properties: {} },
          handler: () => "ok",
        },
      ],
    });
    const run = await agent.send("do it", {
      onDelta: () => {
        callerDeltas += 1;
      },
    });
    for await (const event of run.events()) {
      timeline.push(event);
      if (event.kind === "message") streamed.push(event.message.type);
    }
    await run.wait();
  } finally {
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevKey;
    if (prevUrl === undefined) delete process.env.ANTHROPIC_API_BASE_URL;
    else process.env.ANTHROPIC_API_BASE_URL = prevUrl;
    stub.server.close();
  }
  return { timeline, streamed, callerDeltas };
}

describe("theokit#140 — run.events() is a single ordered timeline", () => {
  it("test_the_timeline_carries_BOTH_messages_and_deltas", async () => {
    // The whole issue in one assertion. A timeline of only messages is `stream()` renamed; one of
    // only deltas is `onDelta` renamed. Either alone leaves the consumer fusing two surfaces, which
    // is the ~200 lines of merge machinery this exists to delete.
    const { timeline } = await drainTimeline();

    expect(timeline.length, "events() yielded nothing at all").toBeGreaterThan(0);
    expect(
      timeline.some((e) => e.kind === "message"),
      "no structural message on the timeline — this is onDelta renamed, not a merge",
    ).toBe(true);
    expect(
      timeline.some((e) => e.kind === "delta"),
      "no delta on the timeline — this is stream() renamed, and the consumer still needs onDelta",
    ).toBe(true);
  }, 30_000);

  it("test_the_timeline_carries_the_structural_events_stream_would", async () => {
    // Completeness floor. `stream()` stays the SDKMessage-only view, so migrating to `events()`
    // must not lose structural events — otherwise the replacement is a downgrade.
    const { streamed } = await drainTimeline();
    expect(streamed, "the timeline carried no SDKMessage types at all").not.toEqual([]);
  }, 30_000);

  it("test_the_callers_own_onDelta_still_fires", async () => {
    // Back-compat floor. The timeline is fed by WRAPPING `SendOptions.onDelta`; a wrap that
    // swallowed the caller's callback would break every existing consumer silently.
    const { callerDeltas } = await drainTimeline();
    expect(callerDeltas, "wrapping onDelta swallowed the caller's callback").toBeGreaterThan(0);
  }, 30_000);
});

/**
 * theokit#140 — the duplicate-text half of the contract.
 *
 * Unifying the source fixed ORDER and the `callId` namespace, and did NOT fix this: the run's event
 * log carries the complete assistant message, and the deltas are additional, so the same text
 * crosses the timeline TWICE from one source. Building the consumption is how that was found — the
 * merge apparatus shrank to nothing except `isDuplicatedByDelta`, which survived on text comparison.
 *
 * Comparing text is the disease. The `callId`-namespace and timestamp-fallback bugs both come from
 * a consumer inferring, by content, a relation it was never told. So the producer states it: the
 * SDK emitted the deltas and emits the message, in the same scope (`real-local-run.ts`), and knows
 * the answer as a FACT. `textAlreadyStreamed` is that fact, and it replaces the inference.
 *
 * Marked rather than suppressed: the assistant message also carries tool calls and metadata, so
 * dropping it would trade a duplicate for a hole. Optional field ⇒ no 4.38.0 consumer breaks.
 */
describe("theokit#140 — the timeline states whether a message's text already streamed", () => {
  it("test_an_assistant_message_whose_text_already_streamed_is_marked", async () => {
    const { timeline } = await drainTimeline();

    const withText = timeline.filter(
      (e) =>
        e.kind === "message" &&
        e.message.type === "assistant" &&
        e.message.message.content.some((b) => b.type === "text"),
    );
    expect(withText.length, "the run produced no assistant message carrying text").toBeGreaterThan(
      0,
    );

    for (const event of withText) {
      expect(
        event.kind === "message" ? event.textAlreadyStreamed : undefined,
        "the text crossed as deltas AND as this message, and the timeline did not say so — " +
          "which is exactly what forces the consumer back to comparing text",
      ).toBe(true);
    }
  }, 30_000);

  it("test_the_marked_text_is_the_text_that_actually_streamed", async () => {
    // Guards the flag against being decorative: it must describe THIS content, not merely record
    // that some delta happened somewhere in the run.
    const { timeline } = await drainTimeline();

    const streamedText = timeline
      .filter((e) => e.kind === "delta" && e.update.type === "text-delta")
      .map((e) => (e.kind === "delta" && e.update.type === "text-delta" ? e.update.text : ""))
      .join("");
    const messageText = timeline
      .filter((e) => e.kind === "message" && e.message.type === "assistant")
      .flatMap((e) =>
        e.kind === "message" && e.message.type === "assistant" ? e.message.message.content : [],
      )
      .filter((b) => b.type === "text")
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("");

    expect(streamedText.length, "no text delta streamed at all in this run").toBeGreaterThan(0);
    expect(
      messageText,
      "the message text and the streamed text differ — the flag would be claiming a duplication " +
        "that is not one",
    ).toContain(streamedText);
  }, 30_000);

  it("test_a_message_carrying_no_text_is_not_marked", async () => {
    // The flag answers "was THIS message's text already shown?". A tool-only assistant message or a
    // structural event has no text, so the question does not apply and a `true` there would be a
    // lie the consumer would act on by hiding content.
    const { timeline } = await drainTimeline();

    for (const event of timeline) {
      if (event.kind !== "message") continue;
      const hasText =
        event.message.type === "assistant" &&
        event.message.message.content.some((b) => b.type === "text");
      if (hasText) continue;
      expect(
        event.textAlreadyStreamed,
        `a ${event.message.type} message with no text was marked as already streamed`,
      ).not.toBe(true);
    }
  }, 30_000);
});
