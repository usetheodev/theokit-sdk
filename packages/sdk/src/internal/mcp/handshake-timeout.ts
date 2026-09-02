/**
 * Which deadline applies to one MCP call.
 *
 * Extracted from `BaseMcpClient.timeoutFor` — where it was a private method, and therefore only
 * reachable through integration tests that spawn child processes and race a hand-picked millisecond
 * count against the cost of starting Node. It is a pure function of three values and now says so.
 *
 * @internal
 */

/** Default per-request MCP timeout (#59). */
export const DEFAULT_MCP_TIMEOUT_MS = 30_000;

/**
 * Floor for the `initialize` handshake, whatever `requestTimeoutMs` says.
 *
 * Sized against what the handshake actually pays for — spawning a child process and waiting for a
 * server to come up — rather than against a steady-state RPC.
 */
export const HANDSHAKE_FLOOR_MS = 10_000;

export interface HandshakeTimeoutInput {
  /** The JSON-RPC method about to be sent. */
  readonly method: string;
  /** Whether the client is inside its own reconnect cycle. */
  readonly reconnecting: boolean;
  /** The caller's `requestTimeoutMs`, already defaulted. */
  readonly requestTimeoutMs: number;
}

/**
 * The deadline for one RPC. The reconnect handshake gets a floor; everything else gets
 * `requestTimeoutMs`.
 *
 * `requestTimeoutMs` sizes a STEADY-STATE request. `initialize` is not one — it is preceded by a
 * process spawn and the server's own startup, and the caller who set a tight request budget was
 * sizing latency, not process creation. Binding both to that number made a tight budget silently
 * unable to CONNECT, and worse, unable to RECONNECT: `reconnect()` spawns a fresh child and calls
 * `initialize()`, so every one of its attempts tried to fit a spawn into a steady-state budget,
 * exhausted the loop and surfaced `mcp_disconnected` — precisely the wedge the bounded-retry loop
 * exists to prevent.
 *
 * A FLOOR, not a replacement: a caller who deliberately sets a LARGER request timeout keeps it.
 * That clause was prose until 2026-09-02 — `Math.max` could have been a bare `HANDSHAKE_FLOOR_MS`
 * and all three integration tests stayed green. `tests/internal/mcp/handshake-timeout.test.ts` is
 * the oracle for it now.
 *
 * SCOPED TO THE RECONNECT HANDSHAKE, not to the first connect, and the difference is which failure
 * is visible. A caller whose `requestTimeoutMs` is too small to connect at ALL finds out
 * immediately, at the call they made, and that is their explicit choice to correct — an existing
 * test pins it (`client-timeout.test.ts`: a silent server rejects within 2s at 150ms, and a floor on
 * first connect would make it wait the floor instead). The reconnect is the SDK's own recovery,
 * which the caller never sized and never sees until a drop happens.
 *
 * A floor on every METHOD would also be wrong for a third reason: it would turn `requestTimeoutMs`
 * into a suggestion, which is a worse defect than the one it fixes. Both halves of the condition
 * matter — the method AND the flag — so an ordinary call mid-reconnect keeps the caller's budget.
 */
export function handshakeAwareTimeout(input: HandshakeTimeoutInput): number {
  const isReconnectHandshake = input.method === "initialize" && input.reconnecting;
  return isReconnectHandshake
    ? Math.max(input.requestTimeoutMs, HANDSHAKE_FLOOR_MS)
    : input.requestTimeoutMs;
}
