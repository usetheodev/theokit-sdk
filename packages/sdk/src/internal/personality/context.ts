/**
 * Personality fork-context (ADR D168 + EC-A snapshot semantic).
 *
 * Uses Node's `AsyncLocalStorage` so a fork's execution chain can know
 * that it is running inside a fork AND can see the slug that was active
 * on the parent **at fork-construction time**.
 *
 * **EC-A:** The slug stored here is captured ONCE at the wrap site
 * (`localAgentFork`) — passing `parentStore.active(parentAgentId)`
 * returns a primitive `string | undefined`, which is then frozen
 * inside the ALS context object. Subsequent `usePersonality` calls on
 * the parent do NOT mutate the fork's view, because the fork reads from
 * its own ALS frame, not from the parent's store.
 *
 * @internal
 */

import { AsyncLocalStorage } from "node:async_hooks";

import { warnOnce } from "../runtime/hooks/hooks-source.js";

/**
 * Snapshot data carried into a fork's async context.
 *
 * @internal
 */
export interface PersonalityForkContext {
  /** Parent's active personality slug at fork-construction time. */
  readonly slug: string | undefined;
  /** Always `true` inside this scope (used by guards). */
  readonly isFork: true;
}

const storage = new AsyncLocalStorage<PersonalityForkContext>();

/**
 * Run `fn` with `ctx` bound as the active fork context. Nested calls
 * shadow the outer context (EC-22).
 *
 * @internal
 */
export function withPersonalityContext<T>(
  ctx: PersonalityForkContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(ctx, fn);
}

/**
 * Return the active fork context, or `undefined` when called outside a
 * fork scope.
 *
 * @internal
 */
export function currentPersonalityContext(): PersonalityForkContext | undefined {
  return storage.getStore();
}

/**
 * Emit one warning per agentId stating that personality switches inside
 * a fork are no-ops. The fork inherits the parent snapshot — runtime
 * mutation is intentionally rejected to keep fork voice deterministic.
 *
 * @internal
 */
export function warnPersonalitySwitchInsideFork(agentId: string): void {
  warnOnce(
    `personality-switch-in-fork-${agentId}`,
    `[theokit-sdk] usePersonality is a no-op inside a fork (D168). Subagents inherit the parent's active personality at fork-construction time.`,
  );
}
