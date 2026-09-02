import { describe, expect, it } from "vitest";

import type { SessionMessage } from "../../src/types/session-message.js";
import { driveLoop } from "../helpers/agent-loop-driver.js";
import { useTempCwd } from "../helpers/temp-workspace.js";

/**
 * usetheokit/theokit-sdk#523 — a resumed session taught the model to TYPE its tool calls.
 *
 * Hydration narrows every stored turn into two projections: `text`, in which a tool call folds to
 * `[tool call] NAME`, and structured `parts`, which carries the call id, the name and the arguments.
 * The replay read `text` alone, so a resumed session handed the model its own prior turn as prose
 * containing a marker:
 *
 *     assistant: I'll run that exact command and report its output.
 *                [tool call] run_shell
 *
 * and the model did the reasonable thing with a pattern it is shown — it wrote the marker instead of
 * calling the tool. Downstream that surfaced as an assistant message whose text ended
 * `"…report its output.[tool call] run_shell"` with no `tool_use` part behind it
 * (usetheokit/theokit#631), where it cost a wrong diagnosis and a prompt change aimed at the model.
 *
 * The failure is quiet in the worst way: the tool did not run, nothing errored, and the transcript
 * reads as the model narrating an action it never took.
 *
 * These assert on WHAT REACHES THE PROVIDER, which is the only place the defect is visible. A unit
 * test of the mapping would have passed throughout — the mapping was never wrong, it was never
 * called.
 */
useTempCwd();

/** A stored turn that called a tool, in both projections, exactly as hydration produces it. */
const TURN_WITH_A_TOOL_CALL: SessionMessage = {
  role: "assistant",
  text: "I'll check that.\n[tool call] run_shell",
  parts: [
    { type: "text", text: "I'll check that." },
    { type: "tool_use", id: "call_1", name: "run_shell", input: { command: "ls" } },
  ],
};

const TOOL_RESULT_TURN: SessionMessage = {
  role: "user",
  text: "[tool result] ok",
  parts: [{ type: "tool_result", toolUseId: "call_1", content: "ok" }],
};

describe("a resumed turn replays history as structure, not as prose", () => {
  it("never shows the model a `[tool call]` marker it can imitate", async () => {
    const { requests } = await driveLoop(process.cwd(), {
      priorMessages: [TURN_WITH_A_TOOL_CALL],
    });

    const wire = JSON.stringify(requests[0]?.messages ?? []);
    expect(
      wire.includes("[tool call]"),
      "the model's own history contains the marker it is being asked not to emit",
    ).toBe(false);
  });

  it("replays the call as a tool_use part carrying id, name and arguments", async () => {
    const { requests } = await driveLoop(process.cwd(), {
      priorMessages: [TURN_WITH_A_TOOL_CALL],
    });

    const parts = (requests[0]?.messages ?? []).flatMap((m) => m.content);
    expect(parts).toContainEqual({
      type: "tool_use",
      id: "call_1",
      name: "run_shell",
      input: { command: "ls" },
    });
  });

  it("puts a tool_result in a user message, the way the live loop already does", async () => {
    // `loop.ts` pushes results as `{ role: "user", content: toolResults }`. A replayed turn must not
    // invent a second convention for the same provider wire — and a `tool_result` inside an
    // assistant message is rejected outright by some of them.
    const { requests } = await driveLoop(process.cwd(), {
      priorMessages: [TURN_WITH_A_TOOL_CALL, TOOL_RESULT_TURN],
    });

    const carrying = (requests[0]?.messages ?? []).filter((m) =>
      m.content.some((p) => p.type === "tool_result"),
    );
    expect(carrying).toHaveLength(1);
    expect(carrying[0]?.role).toBe("user");
  });

  it("replays a turn with no parts exactly as before — older sessions keep their behaviour", async () => {
    // `parts` is optional, and its absence means "this projection carries no structure", never "this
    // turn had none". A message built in memory during a live turn has only `text`, and so does
    // every row written before the structured projection existed.
    const { requests } = await driveLoop(process.cwd(), {
      priorMessages: [{ role: "user", text: "plain question" }],
    });

    expect(requests[0]?.messages?.[0]).toEqual({
      role: "user",
      content: [{ type: "text", text: "plain question" }],
    });
  });
});
