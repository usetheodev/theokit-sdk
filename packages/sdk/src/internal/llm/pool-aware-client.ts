/**
 * `LlmClient` wrapper that pools multiple API keys for the same
 * provider and rotates on HTTP 429/402/401 (ADRs D123-D133).
 *
 * Composition wrapper (D127) — wraps a builder that produces a real
 * `LlmClient` for a given API key. The wrapper picks a key via the
 * pool, instantiates the real client, attempts the stream, and on a
 * pre-stream error decides retry-vs-rotate per the decision matrix.
 *
 * Once `yield*` starts (first event received), rotation is impossible —
 * partial output would corrupt the stream. Same contract as
 * `FallbackLlmClient` (D2).
 *
 * @internal
 */

import {
  AuthenticationError,
  CredentialPoolExhaustedError,
  NetworkError,
  RateLimitError,
} from "../../errors.js";
import type { CredentialPool } from "./credential-pool.js";
import { relayStream, tryFirstEvent } from "./stream-relay.js";
import type { LlmClient, LlmEvent, LlmFinish, LlmRequest } from "./types.js";

/** Decision returned by `classifyAndDecide`. */
type Decision = "retry" | "rotate" | "propagate";

/**
 * Pool-aware `LlmClient`. Constructs real clients on demand via
 * `buildClient(apiKey)` — kept lazy so the pool can pick AT request
 * time (not at construction) and rotation produces a fresh client
 * each iteration.
 *
 * @internal
 */
export class PoolAwareLlmClient implements LlmClient {
  readonly name: string;

  constructor(
    private readonly pool: CredentialPool,
    private readonly buildClient: (apiKey: string) => LlmClient,
  ) {
    this.name = `pool-aware:${pool.provider}`;
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: stream() must serialize pool-select → build client → first-event probe → classify → retry/rotate/propagate. Extracting helpers fragments the linear narrative; the comments above each branch keep it readable.
  async *stream(
    request: LlmRequest,
    signal: AbortSignal,
  ): AsyncGenerator<LlmEvent, LlmFinish, void> {
    let hasRetried429 = false;
    while (true) {
      if (signal.aborted) throw abortError(signal);

      const entry = await this.pool.select();
      if (entry === null) {
        throw new CredentialPoolExhaustedError(
          `All ${this.pool.provider} credentials exhausted; next retry available at ${
            this.nextRetryHint() ?? "unknown"
          }`,
          { provider: this.pool.provider, nextRetryAt: this.nextRetryHint() },
        );
      }

      // EC-D: a failure inside buildClient (e.g., invalid baseUrl) is
      // a transport-config bug, NOT a credential failure. Propagate
      // without marking the entry exhausted.
      let realClient: LlmClient;
      realClient = this.buildClient(entry.accessToken);

      const attempt = await tryFirstEvent(realClient, request, signal);
      if (attempt.kind === "ok") {
        // Stream started — rotation is no longer possible.
        return yield* relayStream(attempt.generator, attempt.firstResult);
      }

      const decision = classifyAndDecide(attempt.error, hasRetried429);
      if (decision === "retry") {
        // D126: first 429 retries the same key. Don't mark exhausted yet.
        hasRetried429 = true;
        continue;
      }
      if (decision === "rotate") {
        // EC-A: persistence failures during rotate must NOT abort the
        // stream. Pool state in-memory is the source of truth; disk
        // staleness self-corrects on the next successful save.
        try {
          await this.pool.markExhaustedAndRotate({
            entryId: entry.id,
            statusCode: attempt.error.metadata?.statusCode ?? inferStatusCode(attempt.error),
            ...(parseRetryAfterMs(attempt.error) !== undefined
              ? { resetAtMs: parseRetryAfterMs(attempt.error) }
              : {}),
          });
        } catch (persistErr) {
          process.stderr.write(
            `[theokit-sdk] credential-pool: persist failed during rotate; continuing in-memory: ${
              persistErr instanceof Error ? persistErr.message : String(persistErr)
            }\n`,
          );
        }
        hasRetried429 = false;
        continue;
      }
      // decision === "propagate"
      throw attempt.error;
    }
  }

  /**
   * Earliest epoch ms among entries' `lastErrorResetAt` — best estimate
   * for the caller's `CredentialPoolExhaustedError.nextRetryAt`.
   */
  private nextRetryHint(): number | undefined {
    const resets = this.pool
      .list()
      .map((e) => e.lastErrorResetAt)
      .filter((v): v is number => v !== undefined);
    return resets.length === 0 ? undefined : Math.min(...resets);
  }
}

/**
 * Decision matrix per ADR D125 + D126. Pure function — testable in isolation.
 *
 * @internal
 */
export function classifyAndDecide(
  error: RateLimitError | AuthenticationError | NetworkError,
  hasRetried429: boolean,
): Decision {
  // 5xx / network errors: pool doesn't help — propagate so cross-provider
  // fallback (FallbackLlmClient) can try a different provider.
  if (error instanceof NetworkError) return "propagate";

  // 401/403: rotate. No OAuth refresh in v1 (out of scope).
  if (error instanceof AuthenticationError) return "rotate";

  // RateLimitError covers 429 AND 402 (billing/quota) — distinguish via statusCode.
  const status = error.metadata?.statusCode ?? 429;
  if (status === 402) return "rotate"; // immediate, no retry (billing won't recover in ms)

  // 429: retry once, rotate on second.
  return hasRetried429 ? "rotate" : "retry";
}

/**
 * Convert provider's `retry-after` hint (seconds) into epoch ms.
 * The error mapper (D67) normalizes the header into `metadata.retryAfter`
 * (numeric seconds form only). Older formats land in `metadata.raw`.
 *
 * @internal
 */
export function parseRetryAfterMs(
  error: RateLimitError | AuthenticationError | NetworkError,
): number | undefined {
  const seconds = error.metadata?.retryAfter;
  if (typeof seconds === "number" && seconds > 0) {
    return Date.now() + seconds * 1000;
  }
  return undefined;
}

function inferStatusCode(error: RateLimitError | AuthenticationError | NetworkError): number {
  if (error instanceof AuthenticationError) return 401;
  if (error instanceof RateLimitError) return 429;
  return 0;
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  return new Error("AbortError");
}
