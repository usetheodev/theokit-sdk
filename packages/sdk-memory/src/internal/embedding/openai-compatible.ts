/**
 * theokit#160 — the shared OpenAI-compatible embedding runtime, re-exported.
 *
 * This file used to be a full COPY of `@theokit/sdk`'s runtime (iter 73, "hybrid copy"). The two
 * copies drifted, and the drift was not cosmetic: core gained bounded-parallel batching (T4.3) and a
 * process-wide cache (T4.4) that the peer never received, while the peer's catalog REPLACES core's
 * at runtime when installed — so consumers WITH the satellite silently ran the slower path.
 *
 * The duplication also produced theokit#128 (four adapters in one copy, missing from the other, for
 * two months), and every fix since had to be applied twice by hand: the `{model}` path substitution,
 * then all three provider dialects.
 *
 * Now there is one implementation, imported from `@theokit/sdk/internal/memory-adapters` — a
 * semver-exempt sub-path in the same family as `internal/persistence` and `internal/security`, which
 * exist for exactly this reason. The peer already depends on `@theokit/sdk/errors`, so no new
 * dependency direction is introduced.
 *
 * Behaviour change for consumers of `@theokit/sdk-memory`: embedding batches now run with bounded
 * parallelism instead of serially, and the cache is process-wide instead of per-adapter. Both are
 * what core already did.
 *
 * @internal
 */

export {
  createOpenAiCompatibleRuntime,
  type EmbeddingDialect,
  type OpenAiCompatibleConfig,
} from "@theokit/sdk/internal/memory-adapters";
