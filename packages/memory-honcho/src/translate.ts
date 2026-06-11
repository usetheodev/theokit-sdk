/**
 * `MemoryContext` → Honcho session-key translation (T4.1).
 *
 * EC-D fix: Honcho sessions are workspace-scoped. Two users with
 * `sessionId === undefined` would otherwise land in the SAME `"default"`
 * session and leak data via `.chat()` recall. Fix: every session key
 * is `${userId}:${sessionId ?? "default"}`.
 *
 * @internal
 */

import type { MemoryContext } from "@theokit/sdk";

export function honchoSessionKey(ctx: MemoryContext): string {
  const session = ctx.sessionId ?? "default";
  return `${ctx.userId}:${session}`;
}

export function honchoPeerKey(ctx: MemoryContext): string {
  return ctx.userId;
}
