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
  memoryMdPath,
  notesDir,
  readFacts,
  readFactsFromMarkdown,
} from "./markdown-store.js";
// Root resolution moved out of the store and into one module (#463). `memoryDir` and
// `memoryWriteDir` are gone: the first was one of fourteen places that answered "where does memory
// live?", and the second was the only one that answered differently.
export {
  asMemoryRoot,
  claudeProjectMemoryDir,
  indexBudgetWarning,
  MEMORY_INDEX_MAX_BYTES,
  MEMORY_INDEX_MAX_LINES,
  type MemoryLocationConfig,
  type MemoryRoot,
  memoryReadRoots,
  projectMemoryDir,
  resolveMemoryRoot,
} from "./memory-root.js";
