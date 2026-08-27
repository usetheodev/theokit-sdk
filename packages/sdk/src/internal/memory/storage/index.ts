/**
 * #430 — the ONE markdown memory store, shared with `@theokit/sdk-memory`.
 *
 * The satellite carried a full copy, and `Memory.runDreamingSweep` REPLACES this one with the
 * peer's whenever the peer is installed — so the copy that ran was not the copy most people read.
 * The copy stayed on the pre-#389 layout (bullets under `MEMORY.md ## Facts`) while this one moved
 * to a file per memory, which meant installing `@theokit/sdk-memory` made every memory the SDK had
 * written unreadable. It reported `factsBefore: 0`, indistinguishable from an empty store.
 *
 * This is the same defect theokit#160 fixed for the embedding runtime, in the same package pair,
 * with the same remedy: one implementation, imported by both. A second copy is a second place for
 * the layout to drift, and the drift is silent by construction — nothing fails, facts just stop
 * being found.
 *
 * Semver-exempt: NOT part of the stable `@theokit/sdk` API. The sub-path IS declared in
 * `package.json` `exports`, so the names below must survive into the published declarations.
 */

export {
  appendFact,
  appendFactToMarkdown,
  claudeProjectMemoryDir,
  memoryDir,
  memoryMdPath,
  memoryWriteDir,
  notesDir,
  readFacts,
  readFactsFromMarkdown,
} from "./markdown-store.js";
