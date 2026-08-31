/**
 * Session summary writing (ADR D20) — re-exported from `@theokit/sdk`, not reimplemented here.
 *
 * This was a byte-identical copy of the SDK's, and `Memory.runDreamingSweep` swaps this package's
 * implementation in whenever it is installed — so the copy that RAN was not the copy anyone had
 * updated. That is the defect #430 removed for `markdown-store`, and the one #463 had to be fixed
 * twice because these four modules were still copies. Same remedy: one implementation, imported.
 */
export {
  type SessionSummaryInput,
  sessionSummaryPath,
  sessionsDir,
  writeSessionSummary,
} from "@theokit/sdk/internal/memory-store";
