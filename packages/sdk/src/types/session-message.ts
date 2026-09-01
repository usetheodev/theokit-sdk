/**
 * Owner: `src/` (1 of 2 importers). Derived from the import graph, not
 * declared — `tests/lint/types-name-their-owner.test.ts` re-derives it.
 *
 * The shape of a persisted session turn, as a HOST reads it.
 *
 * Lives in `types/` because it is public contract — `Agent.transcript()` returns it (theokit#146).
 * `internal/session/session-types.ts` re-exports it so the runtime and the store keep importing
 * from the leaf they always did.
 *
 * @public
 */

import type { ToolResultContentBlock } from "./content-blocks.js";

/**
 * One turn of a session.
 *
 * Two projections of the same turn, and they answer different questions:
 *
 * - `text` is the flat rendering the model replay uses. A tool call folds to `[tool call] NAME` and
 *   a result to `[tool result] <body>`.
 * - `parts` is the same turn unflattened, for a host that draws tool CARDS: the call id, the tool
 *   name, the arguments, and the `toolUseId` that ties a result back to its call — none of which
 *   survive the flat form.
 *
 * `parts` was added in theokit#146 and is additive: `text` is byte-identical to what it always was,
 * so every existing reader is untouched.
 *
 * @public
 */
export interface SessionMessage {
  role: "user" | "assistant";
  text: string;
  /**
   * The structured view. Optional because a `SessionMessage` can also be built in memory during a
   * live turn, where only the text projection exists. Absent means "this projection carries no
   * structure", never "this turn had none".
   */
  parts?: readonly SessionMessagePart[];
}

/**
 * One structured element of a {@link SessionMessage}.
 *
 * Deliberately a session-DISPLAY shape rather than a re-export of the internal LLM part union: the
 * two answer different questions (what to send a provider vs. what to draw), and coupling them
 * would make every provider-wire change a change to what hosts render.
 *
 * @public
 */
export type SessionMessagePart =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "tool_use";
      readonly id: string;
      readonly name: string;
      readonly input: Record<string, unknown>;
    }
  | {
      readonly type: "tool_result";
      readonly toolUseId: string;
      readonly content: string | ReadonlyArray<ToolResultContentBlock>;
      readonly isError?: boolean;
    };
