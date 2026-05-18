import { useCallback, useEffect, useRef, useState } from "react";

import { consumeDataStream } from "./internal/sse-parser.js";

/**
 * Single chat message displayed in the UI.
 *
 * @public
 */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

/**
 * Options for {@link useTheoChat}.
 *
 * @public
 */
export interface UseTheoChatOptions {
  /** Stable agent identifier. Sent in the request body so the server can resume. */
  agentId: string;
  /** Server route emitting Vercel Data Stream v1. Default `/api/theochat`. */
  endpoint?: string;
  /** Initial UI messages to seed the conversation. */
  initialMessages?: ChatMessage[];
}

/**
 * Return shape of {@link useTheoChat}.
 *
 * @public
 */
export interface UseTheoChatResult {
  messages: ChatMessage[];
  input: string;
  setInput: (s: string) => void;
  send: (override?: string) => Promise<void>;
  isStreaming: boolean;
  error: Error | undefined;
  stop: () => void;
}

/**
 * Chat hook that streams responses from a `@usetheo/sdk`-backed agent over
 * an SSE endpoint speaking Vercel Data Stream v1 (see wire-format.md).
 *
 * Pair with {@link streamTheoChat} on the server side.
 *
 * @public
 */
export function useTheoChat(options: UseTheoChatOptions): UseTheoChatResult {
  const endpoint = options.endpoint ?? "/api/theochat";
  const [messages, setMessages] = useState<ChatMessage[]>(options.initialMessages ?? []);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);
  const abortRef = useRef<AbortController | undefined>(undefined);

  // EC-7: AbortController is cancelled on unmount so requests don't leak.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = undefined;
    setIsStreaming(false);
  }, []);

  const send = useCallback(
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: send orchestrates the full lifecycle (build user msg → fetch → status check → SSE consume → finish state) and the linear shape is the API the test suite exercises.
    async (override?: string) => {
      const text = override ?? input;
      if (text.length === 0) return;
      const userMsg: ChatMessage = {
        id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: "user",
        content: text,
        createdAt: Date.now(),
      };
      const assistantMsg: ChatMessage = {
        id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: "assistant",
        content: "",
        createdAt: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setInput("");
      setError(undefined);
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId: options.agentId, messages: [...messages, userMsg] }),
          signal: controller.signal,
        });
        // EC-6: HTTP-level errors propagate to the consumer BEFORE we try
        // to parse SSE. A 4xx/5xx response with a JSON body is the
        // streamTheoChat pre-stream error contract (EC-2).
        if (!response.ok) {
          let bodyMessage = `HTTP ${response.status}`;
          try {
            const body = (await response.json()) as { error?: string; code?: string };
            if (typeof body.error === "string") bodyMessage = body.error;
          } catch {
            // body was not JSON; keep the HTTP-status message
          }
          throw new Error(bodyMessage);
        }
        if (response.body === null) throw new Error("response body is null");
        await consumeDataStream(response.body, {
          onText: (delta) => {
            setMessages((prev) => {
              const copy = prev.slice();
              const last = copy[copy.length - 1];
              if (last !== undefined && last.id === assistantMsg.id) {
                copy[copy.length - 1] = { ...last, content: last.content + delta };
              }
              return copy;
            });
          },
        });
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") {
          // Aborted via stop() or unmount — keep state clean.
        } else {
          setError(cause instanceof Error ? cause : new Error(String(cause)));
        }
      } finally {
        // EC-8: when the SSE stream closes (with or without `d:` finish event),
        // we MUST set isStreaming=false so the UI doesn't hang.
        setIsStreaming(false);
        abortRef.current = undefined;
      }
    },
    [endpoint, input, messages, options.agentId],
  );

  return { messages, input, setInput, send, isStreaming, error, stop };
}
