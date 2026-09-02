/**
 * usetheokit/theokit#631 — the model was being shown its own tool calls as prose.
 *
 * A resumed session replayed each stored turn as `[{ type: "text", text: msg.text }]`, and `text` is
 * the flat projection where a tool call folds to `[tool call] NAME`. The model reads that as its own
 * prior output and reproduces the pattern: it writes the marker instead of calling the tool.
 *
 * The tests below pin the fix from both directions — that the structured parts are used when present
 * (so the marker never reaches the model), and that a message WITHOUT parts replays byte-for-byte as
 * it always did (so a session stored by an older SDK is untouched).
 */
import { describe, expect, it } from "vitest";

import { replayMessages } from "../../src/internal/agent-loop/replay-messages.js";
import type { SessionMessage } from "../../src/types/session-message.js";

describe("replayMessages", () => {
  it("replays a tool call as a tool_use block, not as the flat marker", () => {
    const prior: SessionMessage[] = [
      {
        role: "assistant",
        text: "I'll run that.\n[tool call] run_shell",
        parts: [
          { type: "text", text: "I'll run that." },
          { type: "tool_use", id: "call_1", name: "run_shell", input: { command: "echo hi" } },
        ],
      },
    ];

    const [message, ...rest] = replayMessages(prior);

    expect(rest, "a turn with no results should not produce a second message").toEqual([]);
    expect(message).toEqual({
      role: "assistant",
      content: [
        { type: "text", text: "I'll run that." },
        { type: "tool_use", id: "call_1", name: "run_shell", input: { command: "echo hi" } },
      ],
    });
    expect(
      JSON.stringify(message),
      "the marker reached the model, which is what teaches it to type one",
    ).not.toContain("[tool call]");
  });

  it("puts tool results in their own user message, as the live loop does", () => {
    // `loop.ts` pushes results as `{ role: "user", content: toolResults }`. A replayed turn has to
    // use the same convention: a `tool_result` inside an assistant message is rejected by the
    // provider wires this SDK targets, so getting this wrong turns a resumed session into a 400.
    const prior: SessionMessage[] = [
      {
        role: "assistant",
        text: "…",
        parts: [
          { type: "tool_use", id: "call_1", name: "run_shell", input: {} },
          { type: "tool_result", toolUseId: "call_1", content: "hi", isError: false },
        ],
      },
    ];

    expect(replayMessages(prior)).toEqual([
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "call_1", name: "run_shell", input: {} }],
      },
      {
        role: "user",
        content: [{ type: "tool_result", toolUseId: "call_1", content: "hi", isError: false }],
      },
    ]);
  });

  it("falls back to the flat text when a message carries no parts", () => {
    // Absent parts means "this projection carries no structure", never "this turn had none" — a
    // message built in memory during a live turn has only text, and so does every row written by an
    // SDK from before theokit#146. Both must keep working.
    const prior: SessionMessage[] = [{ role: "user", text: "earlier" }];

    expect(replayMessages(prior)).toEqual([
      { role: "user", content: [{ type: "text", text: "earlier" }] },
    ]);
  });

  it("does not emit a message with empty content", () => {
    // A turn whose only part is a result would otherwise produce an assistant message with an empty
    // content array, which some provider wires reject outright.
    const prior: SessionMessage[] = [
      {
        role: "assistant",
        text: "[tool result] ok",
        parts: [{ type: "tool_result", toolUseId: "call_1", content: "ok" }],
      },
    ];

    expect(replayMessages(prior)).toEqual([
      { role: "user", content: [{ type: "tool_result", toolUseId: "call_1", content: "ok" }] },
    ]);
  });

  it("preserves order across several turns", () => {
    // Anti-vacuity: a function that returned only the last message, or dropped the user turn, would
    // satisfy every assertion above.
    const prior: SessionMessage[] = [
      { role: "user", text: "do it" },
      {
        role: "assistant",
        text: "ok\n[tool call] t",
        parts: [
          { type: "text", text: "ok" },
          { type: "tool_use", id: "c1", name: "t", input: {} },
        ],
      },
    ];

    expect(replayMessages(prior).map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("drops an empty text part, which a tool-call-only turn always carries", () => {
    // `partToText` folds the call and leaves the text empty, so this shape is not hypothetical: it
    // is what every assistant turn that ONLY called a tool projects to. Several provider wires
    // reject an empty text block outright.
    const prior = [
      {
        role: "assistant" as const,
        text: "[tool call] run_shell",
        parts: [
          { type: "text" as const, text: "" },
          { type: "tool_use" as const, id: "c1", name: "run_shell", input: {} },
        ],
      },
    ];

    expect(replayMessages(prior)).toEqual([
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "c1", name: "run_shell", input: {} }],
      },
    ]);
  });

  it("emits nothing for a turn whose only part is empty text", () => {
    // The guard above could have produced `{ role, content: [] }`, which is a message with no
    // content — rejected as readily as the empty block it was avoiding.
    expect(
      replayMessages([{ role: "assistant", text: "", parts: [{ type: "text", text: "" }] }]),
    ).toEqual([]);
  });
});
