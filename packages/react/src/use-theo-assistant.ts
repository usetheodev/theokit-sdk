import { useCallback, useEffect, useRef, useState } from "react";

import { consumeDataStream } from "./internal/sse-parser.js";

/**
 * Options for {@link useTheoAssistant}.
 *
 * @public
 */
export interface UseTheoAssistantOptions {
  /** Server route emitting Vercel Data Stream v1 with `o:`/`O:` codes. */
  endpoint?: string;
}

/**
 * Return shape of {@link useTheoAssistant}.
 *
 * @public
 */
export interface UseTheoAssistantResult<T = unknown> {
  /** Most recent partial OR complete object. Undefined before first emit. */
  object: T | undefined;
  /** True while streaming. */
  isLoading: boolean;
  /** True once `O:` (complete) event arrived for the latest submit. */
  isValid: boolean;
  /** Error from the most recent submit. */
  error: Error | undefined;
  /** Submit a prompt; object updates from partial events; resolves on complete. */
  submit: (prompt: string) => Promise<void>;
  /** Abort the in-flight submit. */
  stop: () => void;
}

/**
 * Object-shaped streaming hook. Wraps `Agent.streamObject<T>` on the server
 * side via `streamAssistant`, surfaces partial objects on the client as
 * they arrive. See ADR D40.
 *
 * The hook is schema-agnostic at the type level (T defaults to `unknown`).
 * For strong typing, pass a generic: `useTheoAssistant<MyType>({ endpoint })`.
 *
 * @public
 */
export function useTheoAssistant<T = unknown>(
  options: UseTheoAssistantOptions = {},
): UseTheoAssistantResult<T> {
  const endpoint = options.endpoint ?? "/api/theoassistant";
  const [object, setObject] = useState<T | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [isValid, setIsValid] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);
  const abortRef = useRef<AbortController | undefined>(undefined);

  // EC-7: unmount cancels.
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

  const submit = useCallback(
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: submit orchestrates the full lifecycle (reset state → fetch → status check → SSE consume → settle); linear shape mirrors the test contract.
    async (prompt: string) => {
      if (prompt.length === 0) return;
      abortRef.current?.abort();
      setObject(undefined);
      setIsValid(false);
      setError(undefined);
      setIsLoading(true);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt }),
          signal: controller.signal,
        });
        if (!response.ok) {
          let bodyMessage = `HTTP ${response.status}`;
          try {
            const body = (await response.json()) as { error?: string };
            if (typeof body.error === "string") bodyMessage = body.error;
          } catch {
            // not JSON
          }
          throw new Error(bodyMessage);
        }
        if (response.body === null) throw new Error("response body is null");
        await consumeDataStream(response.body, {
          onPartialObject: (p) => {
            setObject(p.partial as T);
          },
          onCompleteObject: (p) => {
            setObject(p.object as T);
            setIsValid(true);
          },
        });
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") {
          // silently aborted
        } else {
          setError(cause instanceof Error ? cause : new Error(String(cause)));
        }
      } finally {
        if (abortRef.current === controller) {
          setIsLoading(false);
          abortRef.current = undefined;
        }
      }
    },
    [endpoint],
  );

  return { object, isLoading, isValid, error, submit, stop };
}
