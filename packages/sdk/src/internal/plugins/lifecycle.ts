/**
 * Hook dispatch helpers (T1.4, extracted from manager to keep both modules
 * small).
 *
 *   - `runFireAndForgetHooks` — runs all handlers, swallows + logs throws,
 *     no return value (post_tool_call, on_session_start/end, etc.).
 *   - `runTransformHooks` — chains handlers, each can return a new value
 *     that replaces the input for the next handler. `undefined` keeps the
 *     current; `null` REPLACES current with null (EC-6 explicit).
 *
 * @internal
 */

import type { HookHandler } from "./types.js";

export async function runFireAndForgetHooks<C>(
  handlers: ReadonlyArray<HookHandler>,
  ctx: C,
): Promise<void> {
  for (const h of handlers) {
    try {
      await (h as (c: C) => unknown)(ctx);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[theokit-sdk] plugin hook threw (continuing): ${msg}\n`);
    }
  }
}

export async function runTransformHooks<T>(
  handlers: ReadonlyArray<HookHandler>,
  initial: T,
): Promise<T> {
  let current = initial;
  for (const h of handlers) {
    try {
      const next = await (h as (c: T) => T | undefined)(current);
      // EC-6 explicit semantics: `undefined` = no-op; any other value
      // (including `null`) REPLACES current.
      if (next !== undefined) current = next;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[theokit-sdk] plugin transform hook threw (continuing): ${msg}\n`);
    }
  }
  return current;
}
