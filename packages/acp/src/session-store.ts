/**
 * In-memory session store mapping ACP `sessionId` → `AcpSession` (D356).
 *
 * Per-`serveAcp()` invocation. No global state.
 *
 * @internal
 */

import type { SDKAgent } from "@theokit/sdk";

export interface AcpSession {
  readonly sessionId: string;
  readonly agent: SDKAgent;
  readonly createdAt: number;
  lastUsedAt: number;
  readonly abortController: AbortController;
  readonly cwd: string;
}

export class SessionStore {
  private readonly map = new Map<string, AcpSession>();

  create(session: AcpSession): void {
    if (this.map.has(session.sessionId)) {
      throw new Error(`duplicate sessionId: ${session.sessionId}`);
    }
    this.map.set(session.sessionId, session);
  }

  get(sessionId: string): AcpSession | undefined {
    return this.map.get(sessionId);
  }

  delete(sessionId: string): boolean {
    return this.map.delete(sessionId);
  }

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
