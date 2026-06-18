/**
 * Per-fork tool whitelist via `AsyncLocalStorage` (ADR D111).
 *
 * Forked agents (background review, curator, judge) need a tool subset
 * distinct from the parent's. A global mutable `let _whitelist` would
 * corrupt state when two forks run in parallel. `AsyncLocalStorage`
 * propagates the whitelist through the async chain so each fork sees its
 * own — no cross-fork bleed.
 *
 * Outside a `withToolWhitelist(...)` scope, `currentToolWhitelist()`
 * returns `undefined` and `checkToolWhitelist` allows every tool — the
 * parent agent is unaffected.
 *
 * Wire site: `internal/agent-loop/tool-dispatch.ts:dispatchSingleCall`
 * calls `checkToolWhitelist` after the repair middleware and before
 * `tools.find`.
 *
 * @internal
 */

import { AsyncLocalStorage } from "node:async_hooks";

const toolWhitelistStore = new AsyncLocalStorage<Set<string>>();

/**
 * Run `fn` with `whitelist` as the active tool filter. Nested calls
 * shadow the outer set; the outer is restored on return (EC-F).
 *
 * @internal
 */
export async function withToolWhitelist<T>(
  whitelist: Set<string>,
  fn: () => Promise<T>,
): Promise<T> {
  return toolWhitelistStore.run(whitelist, fn);
}

/**
 * Active tool whitelist for the current async context, or `undefined`
 * when not inside a `withToolWhitelist(...)` scope.
 *
 * @internal
 */
export function currentToolWhitelist(): Set<string> | undefined {
  return toolWhitelistStore.getStore();
}

/**
 * Decision returned by {@link checkToolWhitelist}.
 *
 * @internal
 */
export interface ToolWhitelistDecision {
  allowed: boolean;
  /** Populated only when `allowed === false`. */
  reason?: string;
}

/**
 * Check whether `toolName` is allowed in the current fork context.
 * Returns `{ allowed: true }` when no fork is active — preserves the
 * parent agent's full tool surface.
 *
 * @internal
 */
export function checkToolWhitelist(toolName: string): ToolWhitelistDecision {
  const whitelist = currentToolWhitelist();
  if (whitelist === undefined) return { allowed: true };
  if (!whitelist.has(toolName)) {
    return {
      allowed: false,
      reason: `Tool "${toolName}" not available in this fork context`,
    };
  }
  return { allowed: true };
}
