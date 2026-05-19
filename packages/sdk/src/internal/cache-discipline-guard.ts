/**
 * Dev-mode cache-discipline guard (T3.1, ADRs D94-D95).
 *
 * Warns when system prompt or toolset changes mid-conversation. Such
 * changes invalidate provider prompt cache (10x cost regression — Hermes
 * `AGENTS.md:840-851`). Guard is **dev-mode only** — production hot path
 * pays zero overhead.
 *
 * EC-1 fix: `shouldGuard()` is a function (not a module-init constant)
 * so vitest `vi.stubEnv("NODE_ENV", "production")` can flip behavior
 * mid-test. Snapshot would lock the value at module-load time.
 *
 * @internal
 */

function shouldGuard(): boolean {
  return process.env.NODE_ENV !== "production";
}

/**
 * Warn if system prompt changes between calls. Caller passes the prior
 * and current prompts; identical strings → silent.
 *
 * @internal
 */
export function assertSystemPromptStable(before: string, after: string, reason: string): void {
  if (!shouldGuard()) return;
  if (before === after) return;
  process.stderr.write(
    `[theokit-sdk] cache-discipline: system prompt changed mid-conversation. ` +
      `This invalidates prompt cache (10x cost regression). Reason: ${reason}\n`,
  );
}

/**
 * Warn if toolset shape changes between calls. Compares tool names array
 * via JSON.stringify (order-sensitive — schema change in same-name tool
 * is NOT detected here, just count + name set).
 *
 * @internal
 */
export function assertToolsetStable(
  before: ReadonlyArray<{ name: string }>,
  after: ReadonlyArray<{ name: string }>,
  reason: string,
): void {
  if (!shouldGuard()) return;
  const beforeNames = JSON.stringify(before.map((t) => t.name));
  const afterNames = JSON.stringify(after.map((t) => t.name));
  if (beforeNames === afterNames) return;
  process.stderr.write(
    `[theokit-sdk] cache-discipline: toolset changed mid-conversation. ` +
      `before=${beforeNames} after=${afterNames}. Reason: ${reason}\n`,
  );
}

/**
 * Warn if `after` is not a strict append-only extension of `before`. Any
 * mutation of the first N elements (N === before.length) is a cache-
 * invalidating mutation.
 *
 * @internal
 */
export function assertAppendOnly<M>(
  before: ReadonlyArray<M>,
  after: ReadonlyArray<M>,
  reason: string,
): void {
  if (!shouldGuard()) return;
  if (after.length < before.length) {
    process.stderr.write(
      `[theokit-sdk] cache-discipline: history shrank (${before.length} → ${after.length}). ` +
        `Reason: ${reason}\n`,
    );
    return;
  }
  for (let i = 0; i < before.length; i++) {
    if (before[i] !== after[i]) {
      process.stderr.write(
        `[theokit-sdk] cache-discipline: history mutation at index ${i}. ` + `Reason: ${reason}\n`,
      );
      return;
    }
  }
}
