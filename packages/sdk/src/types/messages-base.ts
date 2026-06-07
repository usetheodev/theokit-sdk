/**
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
