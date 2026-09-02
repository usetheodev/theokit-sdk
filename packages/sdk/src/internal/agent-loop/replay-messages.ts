import type { SessionMessage, SessionMessagePart } from "../../types/session-message.js";
import type { LlmContentPart, LlmMessage } from "../llm/types.js";

/**
 * Rebuild the model's history from a session's stored turns.
 *
 * ## Why this exists
 *
 * The replay used to be one line — `content: [{ type: "text", text: msg.text }]` — and `text` is the
 * FLAT projection, in which a tool call folds to `[tool call] NAME` and a result to
 * `[tool result] <body>`. So a resumed session showed the model its own prior turn as prose
 * containing a marker, and the model did the reasonable thing with a pattern it is shown: it wrote
 * the marker instead of calling the tool (usetheokit/theokit#631). A consumer saw
 * `"…report its output.[tool call] run_shell"` in the assistant's reply, with no tool call behind it.
 *
 * The structured projection was already there. `narrowToSessionMessage` returns BOTH `text` and
 * `parts`, and `parts` carries the call id, the tool name and the arguments — everything the flat
 * form destroys. Nothing read it: `msg.parts` appeared nowhere in the shipped bundle.
 *
 * ## The shape it produces
 *
 * `SessionMessagePart` and `LlmContentPart` agree field for field on all three cases, which is what
 * makes this a mapping rather than a translation. What does NOT carry over is the grouping: a
 * `tool_result` may not travel in an assistant message. The live loop already settles that —
 * `loop.ts` pushes results as `{ role: "user", content: toolResults }` — so a replayed turn is split
 * the same way rather than inventing a second convention for the same provider wire.
 *
 * ## When it falls back
 *
 * `parts` is optional and its absence means "this projection carries no structure", never "this turn
 * had none" — a `SessionMessage` built in memory during a live turn has only `text`. So a message
 * without parts replays exactly as before. That is also what keeps this safe for a session stored by
 * an older SDK: those rows have no `parts`, and they keep the behaviour they were written under.
 *
 * ## An empty text part is dropped
 *
 * A `{ type: "text", text: "" }` survives the projection — a turn that was only a tool call has one,
 * because `partToText` folds the call and leaves the text empty. Several provider wires reject an
 * empty text block outright, and none of them need it, so it does not travel. Dropping it is also
 * what makes the `own.length > 0` guard below meaningful rather than incidental.
 */
export function replayMessages(prior: readonly SessionMessage[]): LlmMessage[] {
  return prior.flatMap(replayTurn);
}

/**
 * One stored turn as the messages a provider should see — none, one, or two.
 *
 * Two when the turn both produced content and carried tool results: those cannot travel together,
 * so the results leave as their own user message.
 */
function replayTurn(msg: SessionMessage): LlmMessage[] {
  if (msg.parts === undefined || msg.parts.length === 0) {
    return [{ role: msg.role, content: [{ type: "text", text: msg.text }] }];
  }
  const { own, results } = splitParts(msg.parts);
  const out: LlmMessage[] = [];
  // An empty `own` would be a message with no content, which some provider wires reject outright.
  if (own.length > 0) out.push({ role: msg.role, content: own });
  if (results.length > 0) out.push({ role: "user", content: results });
  return out;
}

/** The turn's own content, and the tool results that have to leave separately. */
function splitParts(parts: readonly SessionMessagePart[]): {
  own: LlmContentPart[];
  results: LlmContentPart[];
} {
  const own: LlmContentPart[] = [];
  const results: LlmContentPart[] = [];
  for (const part of parts) {
    if (part.type === "tool_result") {
      results.push(toToolResult(part));
      continue;
    }
    // An empty text block is rejected outright by several provider wires and carries nothing.
    if (part.type === "text" && part.text.length === 0) continue;
    own.push({ ...part });
  }
  return { own, results };
}

function toToolResult(part: Extract<SessionMessagePart, { type: "tool_result" }>): LlmContentPart {
  return {
    type: "tool_result",
    toolUseId: part.toolUseId,
    // `SessionMessagePart` holds the blocks readonly and `LlmToolResultPart` takes a mutable array:
    // same elements, different variance, so the copy is the whole conversion.
    content: typeof part.content === "string" ? part.content : [...part.content],
    ...(part.isError === undefined ? {} : { isError: part.isError }),
  };
}
