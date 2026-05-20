import { useCallback, useEffect, useRef, useState } from "react";

import { consumeDataStream } from "./internal/sse-parser.js";

/**
 * Options for {@link useTheoCompletion}.
 *
 * @public
 */
export interface UseTheoCompletionOptions {
  /** Server route emitting Vercel Data Stream v1. Default `/api/theocompletion`. */
  endpoint?: string;
  /** Initial completion string (e.g., to restore from server-rendered HTML). */
  initialCompletion?: string;
}

/**
 * Return shape of {@link useTheoCompletion}.
 *
 * @public
 */
export interface UseTheoCompletionResult {
  /** Current completion text. Replaced on every new `complete()` call. */
  completion: string;
  /** Form input value (controlled). */
  input: string;
  /** Setter for the input value. */
  setInput: (s: string) => void;
  /** Trigger a completion. If `override` is passed, uses it instead of `input`. */
  complete: (override?: string) => Promise<void>;
  /** True while streaming a completion. */
  isLoading: boolean;
  /** Error from the most recent completion, if any. */
  error: Error | undefined;
  /** Abort the in-flight completion (if any). */
  stop: () => void;
}

/**
 * Single-shot text generation hook. Equivalent to Vercel AI `useCompletion`.
 * `completion` is REPLACED on each `complete()` call (no history). For
 * multi-turn chat, use {@link useTheoChat}. See ADR D40.
 *
 * Pair with {@link streamCompletion} on the server side.
 *
 * @public
 */
export function useTheoCompletion(options: UseTheoCompletionOptions = {}): UseTheoCompletionResult {
  const endpoint = options.endpoint ?? "/api/theocompletion";
  const [completion, setCompletion] = useState(options.initialCompletion ?? "");
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);
  const abortRef = useRef<AbortController | undefined>(undefined);

  // EC-7: unmount cancels in-flight fetch.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = undefined;
    setIsLoading(false);
  }, []);

  const complete = useCallback(
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: complete orchestrates the full lifecycle (abort prior, reset, fetch, SSE consume, settle); refactoring fragments the EC-7 race-handling.
    async (override?: string) => {
      const text = override ?? input;
      if (text.length === 0) return;
      // EC-7 mitigation: abort any in-flight call before starting a new one.
      abortRef.current?.abort();
      setCompletion("");
      setError(undefined);
      setIsLoading(true);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: text }),
          signal: controller.signal,
        });
        if (!response.ok) {
          let bodyMessage = `HTTP ${response.status}`;
          try {
            const body = (await response.json()) as { error?: string };
            if (typeof body.error === "string") bodyMessage = body.error;
          } catch {
            // not JSON body
          }
          throw new Error(bodyMessage);
        }
        if (response.body === null) throw new Error("response body is null");
        // Use refs for partial completion accumulation; setState batches.
        let acc = "";
        await consumeDataStream(response.body, {
          onText: (delta) => {
            acc += delta;
            setCompletion(acc);
          },
        });
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") {
          // Aborted via stop()/unmount/concurrent-call — silent.
        } else {
          setError(cause instanceof Error ? cause : new Error(String(cause)));
        }
      } finally {
        // EC-7: concurrent complete() — only the LATEST controller clears
        // loading state. Earlier aborted ones don't unset it.
        if (abortRef.current === controller) {
          setIsLoading(false);
          abortRef.current = undefined;
        }
      }
    },
    [endpoint, input],
  );

  return { completion, input, setInput, complete, isLoading, error, stop };
}
