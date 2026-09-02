/**
 * Owner: `types/` (2 of 2 importers: conversation.ts, updates.ts). The only module in this folder
 * whose owner IS the layer — it exists to break a type-only cycle BETWEEN two of its siblings, so
 * pointing it at a subsystem would name something that does not use it.
 *
 * Type-leaf — base message types shared between `conversation.ts` and
 * `updates.ts`. Extracted to break LOW type-only cycle #6 (audit
 * `architecture-output/final_report.md`) per plan arch-review-fixes-2026-06-06
 * § Phase 4 / T4.1 (D438).
 *
 * Public surface unchanged — `types/conversation.ts` re-exports `UserMessage`
 * from this leaf so `import type { UserMessage } from "@theokit/sdk"` keeps
 * resolving.
 *
 * @public
 */

/**
 * User-authored message in a conversation history.
 *
 * @public
 */
export interface UserMessage {
  text: string;
}
