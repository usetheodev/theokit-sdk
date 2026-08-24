/**
 * `MemoryContext` → Honcho session-key translation (T4.1).
 *
 * EC-D fix: Honcho sessions are workspace-scoped. Two users with
 * `sessionId === undefined` would otherwise land in the SAME `"default"`
 * session and leak data via `.chat()` recall. Fix: every session key
 * is `${userId}--${sessionId ?? "default"}`.
 *
 * B-049: was `${userId}:${session}`. The real `@honcho-ai/sdk` validates session
 * (and peer) ids against `/^[a-zA-Z0-9_-]+$/` (`SessionIdSchema`,
 * `node_modules/@honcho-ai/sdk/dist/validation.js:140`) — a colon is not in that
 * alphabet, so `.session()` threw a `ZodError` on EVERY call, unconditionally. The
 * `vi.mock("@honcho-ai/sdk")` unit tests never caught it because a hand-written
 * mock does not validate its inputs the way the vendor's real schema does. Caught by
 * `tests/wire-contract.test.ts`, which runs the real SDK. `--` keeps the same
 * collision-avoidance property (unique per userId+session pair) while staying inside
 * the vendor's allowed alphabet.
 *
 * @internal
 */

import type { MemoryContext } from "@theokit/sdk";

export function honchoSessionKey(ctx: MemoryContext): string {
  const session = ctx.sessionId ?? "default";
  return `${ctx.userId}--${session}`;
}

export function honchoPeerKey(ctx: MemoryContext): string {
  return ctx.userId;
}
