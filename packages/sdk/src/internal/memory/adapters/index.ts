/**
 * theokit#160 — the ONE embedding runtime, shared with `@theokit/sdk-memory`.
 *
 * The satellite used to carry a full copy of `createOpenAiCompatibleRuntime`, and the peer's catalog
 * REPLACES core's at runtime when installed — so the copy that ran was not the copy most people
 * read. That duplication produced theokit#128 (four adapters present in one copy, missing from the
 * other, for two months), and every fix since had to be applied twice by hand: the `{model}` path
 * substitution, then all three provider dialects.
 *
 * This is the shared leaf both packages now import. Semver-exempt, exactly like the
 * `internal/persistence` and `internal/security` sub-paths that exist for the same reason: extracted
 * packages need primitives that are not part of the stable public contract.
 *
 * @internal — semver-exempt. Not part of the stable `@theokit/sdk` API.
 */

// NOTE: the adapter/runtime TYPES are deliberately NOT re-exported here. `embedding-adapter.ts` is
// marked `@internal` and `tsconfig.base.json` sets `stripInternal: true`, so tsc elides a pure
// `export type` of them from the emitted `.d.ts` — the re-export would compile and then vanish,
// which is worse than not offering it. `@theokit/sdk-memory` keeps its own structurally-identical
// copy in `internal/embedding/embedding-adapter.ts` and annotates against that.
export { globalEmbeddingCache, LruEmbeddingCache } from "../embedding-cache.js";
export {
  createOpenAiCompatibleRuntime,
  type EmbeddingDialect,
  type OpenAiCompatibleConfig,
} from "./openai-compatible.js";
