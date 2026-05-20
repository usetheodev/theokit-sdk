/**
 * Shared SSE parser for Vercel AI Data Stream v1 (ADR D38, extended by D45).
 *
 * Consumed by `useTheoChat`, `useTheoCompletion`, and `useTheoAssistant`.
 * Extending: pass handler callbacks for the codes you care about; unknown
 * codes are silently ignored (forward-compat, EC-11).
 *
 * @internal
 */

/**
 * Handlers for each wire-format code. All optional — unspecified codes are
 * ignored. Throwing from any handler aborts the stream (caught by caller).
 *
 * @internal
 */
export interface DataStreamHandlers {
  /** Code `0:` — text delta. */
  onText?: (delta: string) => void;
  /** Code `9:` — tool call started. */
  onToolStart?: (payload: { toolCallId: string; toolName: string; args?: unknown }) => void;
  /** Code `a:` — tool call completed. */
  onToolEnd?: (payload: { toolCallId: string; result: unknown }) => void;
  /** Code `d:` — finish event. Terminates the stream cleanly. */
  onFinish?: (payload: { finishReason: string; usage?: unknown }) => void;
  /** Code `3:` — error event. Caller should propagate. */
  onError?: (message: string) => void;
  /** Code `o:` — partial object (ADR D45, useTheoAssistant). */
  onPartialObject?: (payload: { partial: unknown; attempt: number }) => void;
  /** Code `O:` — complete object (ADR D45, useTheoAssistant). */
  onCompleteObject?: (payload: { object: unknown }) => void;
}

/**
 * Read a ReadableStream emitting Vercel Data Stream v1 and dispatch each
 * record to the matching handler. Returns when the stream closes
 * (gracefully or via `d:` finish). Throws on `3:` error events.
 *
 * @internal
 */
export async function consumeDataStream(
  body: ReadableStream<Uint8Array>,
  handlers: DataStreamHandlers,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += decoder.decode(value, { stream: true });
    let nl = buf.indexOf("\n");
    while (nl >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      nl = buf.indexOf("\n");
      if (line.length === 0) continue;
      const code = line[0];
      const payloadJson = line.slice(2);
      dispatchLine(code, payloadJson, handlers);
      // dispatchLine may throw for `3:` errors; let it propagate up so the
      // consumer hook's try/catch handles it.
    }
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: dispatcher must enumerate every wire code in a single switch; refactoring to per-code helpers harms parser locality.
function dispatchLine(
  code: string | undefined,
  payloadJson: string,
  handlers: DataStreamHandlers,
): void {
  if (code === undefined) return;
  try {
    switch (code) {
      case "0": {
        if (handlers.onText) handlers.onText(JSON.parse(payloadJson) as string);
        return;
      }
      case "9": {
        if (handlers.onToolStart) handlers.onToolStart(JSON.parse(payloadJson));
        return;
      }
      case "a": {
        if (handlers.onToolEnd) handlers.onToolEnd(JSON.parse(payloadJson));
        return;
      }
      case "d": {
        if (handlers.onFinish) handlers.onFinish(JSON.parse(payloadJson));
        return;
      }
      case "3": {
        const msg = JSON.parse(payloadJson) as string;
        if (handlers.onError) handlers.onError(msg);
        throw new Error(msg);
      }
      case "o": {
        if (handlers.onPartialObject) handlers.onPartialObject(JSON.parse(payloadJson));
        return;
      }
      case "O": {
        if (handlers.onCompleteObject) handlers.onCompleteObject(JSON.parse(payloadJson));
        return;
      }
      default:
        // EC-11: unknown codes are forward-compat — ignored silently.
        return;
    }
  } catch (e) {
    if (e instanceof Error && code === "3") throw e;
    // malformed JSON; ignore this line.
  }
}
