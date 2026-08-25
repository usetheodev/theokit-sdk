/**
 * usetheokit/theokit-sdk#383 — derive the provider prompt-cache key from the session identity.
 *
 * The Responses API reuses a cached prompt prefix only when consecutive requests carry the SAME
 * `prompt_cache_key`. Without it every round of a turn is a cold prompt: the whole system prompt and
 * the whole tool schema are re-charged. Measured against OpenAI Codex on the same provider, the same
 * model and the same task, the SDK sent a THIRD of the bytes (24,691 c vs 76,331 c) and paid 2.8x the
 * tokens (24,914 vs 9,036). The difference was not what was sent — it was that theirs was cached.
 *
 * **The key has to be right in two directions, and getting either wrong is worse than sending
 * nothing.** A key that changes per round caches nothing while telling the provider it should have;
 * a key shared between unrelated sessions asks the provider to match one session's prefix against
 * another's, which is a correctness hazard rather than a missed optimisation. So the key is derived
 * from the identity that already means "this conversation" — the session/agent id (`agentId`, the
 * `Agent.getOrCreate(sessionId)` key). That id is fixed for the life of the session: constant across
 * every round of a turn, constant across every turn, and freshly generated (`agent-<uuid>`) for a
 * session the caller did not name. No second identity is minted here, because a second identity is a
 * second thing that can drift out of step with the first.
 *
 * **Why it is hashed rather than sent raw.** A session id is frequently caller-chosen
 * (`Agent.create({ agentId: "acme-billing-migration" })`), and the cache key travels to the provider
 * on every request. Hashing keeps the grouping the provider needs while disclosing nothing about what
 * the session is called. SHA-256 is deterministic, so a session resumed in a new process derives the
 * same key and can still hit the cache — which a random per-process value could not.
 *
 * @internal
 */
import { createHash } from "node:crypto";

/** Prefix so a key found in a provider log is attributable to this SDK rather than anonymous. */
const KEY_PREFIX = "theokit-";

/**
 * 32 hex characters (128 bits) of SHA-256. Long enough that a collision between two sessions is not
 * a thing that happens; short enough to stay well inside the provider's field length limit.
 */
const KEY_HEX_LENGTH = 32;

/**
 * Derive a stable, opaque `prompt_cache_key` for a session.
 *
 * Returns `undefined` for an absent or blank session id. That branch is deliberate and is the whole
 * anti-collision guard: hashing `""` yields ONE constant, which every unnamed session would then
 * share — the exact cross-session key collision this function exists to avoid. No key is strictly
 * better than a shared one.
 *
 * @internal
 */
export function derivePromptCacheKey(sessionId: string | undefined): string | undefined {
  if (sessionId === undefined || sessionId.trim().length === 0) return undefined;
  const digest = createHash("sha256").update(sessionId, "utf8").digest("hex");
  return `${KEY_PREFIX}${digest.slice(0, KEY_HEX_LENGTH)}`;
}
