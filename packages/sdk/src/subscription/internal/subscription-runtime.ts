/**
 * Subscription runtime (G8 internal) — `@theokit/sdk`.
 *
 * Per ADR D422 (Form 4 Hybrid). Hosts registered {@link SubscriptionDescriptor}
 * + dispatches incoming subscription requests across SSE / WS transports.
 *
 * @internal
 */

import { TheokitAgentError } from "../../errors.js";
import {
  isTrackedEnvelope,
  tracked as makeTracked,
  type SubscriptionCtx,
  type SubscriptionDescriptor,
  SubscriptionError,
  SubscriptionInputError,
  type SubscriptionTransport,
  type TrackedEnvelope,
} from "../types.js";
import { encodeSseChunk } from "./sse-encoder.js";

/**
 * Wire format used by the WS transport. Mirrors SSE chunk shape so encoder/decoder
 * stay symmetric across transports. Per ADR D424 the WS payload is JSON-encoded.
 *
 * @internal
 */
export interface WireFrame {
  readonly type: "data" | "tracked" | "end" | "error";
  readonly id?: string;
  readonly data?: unknown;
  readonly error?: { message: string; code?: string };
}

/**
 * Build an error frame that carries the cause's CODE, not only its sentence.
 *
 * `WireFrame.error.code` was declared here and written by nobody: all three producers sent
 * `{ message }`, and the WS client turned every inbound error into one `ws_server_error`. So a
 * subsystem that defines coded errors on purpose — `subscription_input_invalid`,
 * `subscription_disconnected` — collapsed all of them to a single code at the wire, and the real
 * reason survived only as interpolated English inside a message.
 *
 * A shared builder rather than three literals, because a declared-and-never-written field is exactly
 * what happens when each site decides for itself.
 */
export function errorFrame(cause: unknown): WireFrame {
  const message = cause instanceof Error ? cause.message : String(cause);
  const code = cause instanceof TheokitAgentError ? cause.code : undefined;
  return { type: "error", error: { message, ...(code === undefined ? {} : { code }) } };
}

/**
 * Options consumed by {@link SubscriptionRuntime.dispatch}.
 *
 * @internal
 */
export interface DispatchOptions {
  /** Subscription name (matches descriptor.name OR scanner-derived path slug). */
  readonly name: string;
  /** Raw input from the client (validated by descriptor.input.safeParse). */
  readonly rawInput: unknown;
  /** Transport selected for this dispatch. */
  readonly transport: Exclude<SubscriptionTransport, "auto">;
  /** Resume token forwarded from client (if any). */
  readonly lastEventId?: string;
  /** Stable connection identifier (per-WS-socket or per-SSE-request). */
  readonly connectionId: string;
  /** Cancellation signal. Fires on client disconnect. */
  readonly signal: AbortSignal;
  /** Disconnect hook surfaced via SubscriptionCtx. */
  readonly disconnect: (code?: number, reason?: string) => void;
}

/**
 * Outcome of a dispatch call. Returns a ReadableStream<Uint8Array> for SSE
 * transport OR a WS frame async iterable for WS transport.
 *
 * @internal
 */
export type DispatchResult =
  | { transport: "sse"; stream: ReadableStream<Uint8Array> }
  | { transport: "ws"; iterable: AsyncIterable<WireFrame> };

/**
 * In-process registry + dispatcher for subscriptions.
 *
 * @internal
 */
export class SubscriptionRuntime {
  private readonly registry = new Map<string, SubscriptionDescriptor<unknown, unknown>>();
  private activeCount = 0;

  /** Register a subscription descriptor under `name` (or descriptor.name). */
  register<TInput, TOutput>(
    name: string,
    descriptor: SubscriptionDescriptor<TInput, TOutput>,
  ): void {
    if (this.registry.has(name)) {
      throw new SubscriptionError(`Subscription already registered: ${name}`, {
        code: "subscription_duplicate",
      });
    }
    this.registry.set(name, descriptor as SubscriptionDescriptor<unknown, unknown>);
  }

  /** Remove a registered subscription. */
  unregister(name: string): boolean {
    return this.registry.delete(name);
  }

  /** Look up a descriptor by name (test/debug helper). */
  get(name: string): SubscriptionDescriptor<unknown, unknown> | undefined {
    return this.registry.get(name);
  }

  /** Active dispatch count for ops visibility. */
  getActiveConnectionCount(): number {
    return this.activeCount;
  }

  /**
   * Dispatch an incoming subscription request. Validates input, invokes the
   * handler, encodes outputs per the selected transport.
   */
  dispatch(opts: DispatchOptions): DispatchResult {
    const descriptor = this.registry.get(opts.name);
    if (descriptor === undefined) {
      throw new SubscriptionError(`Unknown subscription: ${opts.name}`, {
        code: "subscription_not_found",
      });
    }
    const parsed = descriptor.input.safeParse(opts.rawInput);
    if (!parsed.success) {
      throw new SubscriptionInputError(`Invalid input for subscription: ${opts.name}`, {
        issues: parsed.error,
      });
    }
    const ctx: SubscriptionCtx = {
      ...(opts.lastEventId !== undefined ? { lastEventId: opts.lastEventId } : {}),
      signal: opts.signal,
      connectionId: opts.connectionId,
      disconnect: opts.disconnect,
      tracked: <TPayload>(id: string, payload: TPayload) => makeTracked(id, payload),
    };
    const iterator = descriptor.handler(parsed.data, ctx);
    this.activeCount++;
    const release = () => {
      this.activeCount = Math.max(0, this.activeCount - 1);
    };
    if (opts.transport === "sse") {
      return { transport: "sse", stream: encodeSseStream(iterator, release) };
    }
    return { transport: "ws", iterable: encodeWsIterable(iterator, release) };
  }
}

function encodeSseStream(
  iterator: AsyncGenerator<unknown, void, void>,
  release: () => void,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Emit the `connected` event so clients can detect handshake completion
        controller.enqueue(encodeSseChunk({ event: "connected", data: "" }));
        for await (const value of iterator) {
          const chunk = toSseChunk(value);
          controller.enqueue(encodeSseChunk(chunk));
        }
        controller.enqueue(encodeSseChunk({ event: "end", data: "" }));
      } catch (cause) {
        const msg = cause instanceof Error ? cause.message : String(cause);
        controller.enqueue(
          encodeSseChunk({
            event: "error",
            data: JSON.stringify({ message: msg }),
          }),
        );
      } finally {
        release();
        controller.close();
      }
    },
    cancel() {
      release();
    },
  });
}

function toSseChunk(value: unknown): {
  event?: string;
  data: string;
  id?: string;
} {
  if (isTrackedEnvelope(value)) {
    const [id, payload] = value as TrackedEnvelope<unknown>;
    return { event: "message", id, data: JSON.stringify(payload) };
  }
  return { event: "message", data: JSON.stringify(value) };
}

async function* encodeWsIterable(
  iterator: AsyncGenerator<unknown, void, void>,
  release: () => void,
): AsyncIterable<WireFrame> {
  try {
    for await (const value of iterator) {
      if (isTrackedEnvelope(value)) {
        const [id, payload] = value as TrackedEnvelope<unknown>;
        yield { type: "tracked", id, data: payload };
      } else {
        yield { type: "data", data: value };
      }
    }
    yield { type: "end" };
  } catch (cause) {
    yield errorFrame(cause);
  } finally {
    release();
  }
}
