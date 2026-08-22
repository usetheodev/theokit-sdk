/**
 * In-memory session store mapping ACP `sessionId` → `AcpSession` (D356).
 *
 * Per-`serveAcp()` invocation. No global state.
 *
 * @internal
 */

import type { SDKAgent } from "@theokit/sdk";

/** One live ACP session: the agent serving it, its cwd, its abort handle, and access timestamps. */
export interface AcpSession {
  readonly sessionId: string;
  readonly agent: SDKAgent;
  readonly createdAt: number;
  lastUsedAt: number;
  readonly abortController: AbortController;
  readonly cwd: string;
}

/**
 * Sessions held by one `serveAcp` call. In-memory only: a restart loses every entry, which is why
 * `session/load` goes back through the SDK's conversation storage instead of this map.
 *
 * Not thread-safe and does not need to be — one Node process, one event loop.
 */
export class SessionStore {
  private readonly map = new Map<string, AcpSession>();

  /** @throws Error on a duplicate id — the caller must have checked `has` first. */
  create(session: AcpSession): void {
    if (this.map.has(session.sessionId)) {
      throw new Error(`duplicate sessionId: ${session.sessionId}`);
    }
    this.map.set(session.sessionId, session);
  }

  get(sessionId: string): AcpSession | undefined {
    return this.map.get(sessionId);
  }

  /** `true` when an entry was removed. Does NOT dispose the agent or abort its controller. */
  delete(sessionId: string): boolean {
    return this.map.delete(sessionId);
  }

  /** A new array over the live session objects — the array is a copy, the sessions are not. */
  list(): AcpSession[] {
    return [...this.map.values()];
  }

  size(): number {
    return this.map.size;
  }

  has(sessionId: string): boolean {
    return this.map.has(sessionId);
  }
}
