/**
 * `AbortSignal` composition helpers (Production-Readiness #5 / EC-5, ADR D324).
 *
 * `AbortSignal.any` is available in Node 22+ and Cloudflare Workers, but
 * some runtime environments (a peer vendor Edge subset, older Bun, embedded shells)
 * still lag. The ponyfill mirrors the spec semantics — abort on first signal,
 * propagate `reason` — without depending on the host symbol.
 *
 * @internal
 */

/**
 * Compose multiple `AbortSignal`s into a single signal that fires as soon as
 * any of the inputs aborts. Uses native `AbortSignal.any` when available;
 * otherwise constructs an `AbortController` with `once: true` listeners.
 */
export function anySignal(signals: ReadonlyArray<AbortSignal | undefined>): AbortSignal {
  const filtered = signals.filter((s): s is AbortSignal => s !== undefined);
  if (filtered.length === 0) {
    // Never-aborting signal — caller passed nothing.
    return new AbortController().signal;
  }
  if (filtered.length === 1) {
    return filtered[0] as AbortSignal;
  }
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any(filtered as AbortSignal[]);
  }
  return ponyfillAny(filtered);
}

function ponyfillAny(signals: AbortSignal[]): AbortSignal {
  const ctrl = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      ctrl.abort(s.reason);
      return ctrl.signal;
    }
    s.addEventListener("abort", () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}

/**
 * `true` when the given (possibly undefined) signal has aborted. `undefined`
 * signal counts as not aborted (no-signal semantics).
 */
export function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

/**
 * Extract the abort reason as an `Error` for wrapping into `AgentRunError`.
 * Spec: `signal.reason` is `unknown` — wrap non-Error values into a generic
 * error so callers always have a `.message` to inspect.
 */
export function abortReasonAsError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  if (signal.reason !== undefined) return new Error(String(signal.reason));
  return new Error("AbortError: signal aborted");
}
