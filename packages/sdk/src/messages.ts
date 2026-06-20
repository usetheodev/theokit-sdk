/**
 * Pure readers over the `SDKMessage` stream (M1-5).
 *
 * Promotes the proven first-party hand-roll (`../theocode/server/lib/sdk-mappers.ts`)
 * onto the SDK's own types so consumers stop re-implementing a wire-event mapper.
 * Every reader is pure: no I/O, no mutation of its input, deterministic.
 *
 * Public from the `@theokit/sdk/messages` sub-path. See `docs.md → Message readers`.
 */

import type { SDKMessage, ToolUseBlock } from "./types/messages.js";
import type { CostBreakdown } from "./types/usage.js";

/**
 * Concatenate the text of an assistant message's `TextBlock`s.
 *
 * Returns `""` for any non-assistant message (or an assistant with no text
 * blocks). `tool_use` blocks are ignored — only `text` blocks contribute.
 */
export function assistantText(msg: SDKMessage): string {
  if (msg.type !== "assistant") {
    return "";
  }
  return msg.message.content
    .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("");
}

/**
 * Extract the `ToolUseBlock`s from an assistant message's content.
 *
 * Returns `[]` for any non-assistant message. This reads the assistant
 * message's content blocks — NOT the separate `SDKToolUseMessage`
 * (`type:"tool_call"`) lifecycle event, which is a different stream (ADR D2).
 */
export function extractToolUses(msg: SDKMessage): ToolUseBlock[] {
  if (msg.type !== "assistant") {
    return [];
  }
  return msg.message.content.filter((block): block is ToolUseBlock => block.type === "tool_use");
}

/**
 * Read the cost amount from a `CostBreakdown`, preserving the honesty contract
 * (repo ADR `D377-cost-status-closed-enum.md`): `amountUsd` is `number | undefined`
 * where `undefined` means "cost unknown" — distinct from a real `$0` (e.g. a
 * subscription-included route). NEVER coerced to 0.
 */
export function costAmountUsd(cost: CostBreakdown | undefined): number | undefined {
  return cost?.amountUsd;
}
