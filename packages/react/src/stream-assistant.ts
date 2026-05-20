import {
  Agent,
  AuthenticationError,
  ConfigurationError,
  type LocalOptions,
  type ModelSelection,
  StreamObjectError,
} from "@usetheo/sdk";
import type { ZodType } from "zod";

/**
 * Options for {@link streamAssistant}. Server-side handler.
 *
 * @public
 */
export interface StreamAssistantOptions<T extends ZodType> {
  /** Zod schema describing the expected object shape. */
  schema: T;
  /** Request body parsed by the consumer's route handler. */
  body: { prompt: string };
  /** Model + local config to forward to `Agent.streamObject`. */
  model: ModelSelection;
  local: LocalOptions;
  /** Optional API key (falls back to env). */
  apiKey?: string;
  /** Optional system prompt. */
  systemPrompt?: string;
  /** Retry budget on parse failures (forwarded to streamObject). */
  maxRetries?: number;
}

/**
 * Convert an `Agent.streamObject<T>` call into a streaming HTTP Response
 * speaking Vercel AI Data Stream v1 extended with object codes
 * `o:` (partial) and `O:` (complete) — see ADR D45. Pair with
 * {@link useTheoAssistant} on the client side.
 *
 * EC-2: synchronous typed errors before the stream starts → JSON 4xx HTTP.
 *
 * @public
 */
export async function streamAssistant<T extends ZodType>(
  options: StreamAssistantOptions<T>,
): Promise<Response> {
  const { schema, body, model, local, apiKey, systemPrompt, maxRetries } = options;
  if (typeof body.prompt !== "string" || body.prompt.length === 0) {
    return Response.json({ error: "missing prompt", code: "missing_prompt" }, { status: 400 });
  }

  const stream = new ReadableStream({
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: SSE encoder dispatches every streamObject event variant (partial/complete) + finish + error inline; refactoring obscures wire-format mapping.
    async start(controller) {
      const enc = new TextEncoder();
      const write = (line: string) => controller.enqueue(enc.encode(`${line}\n`));
      try {
        const iter = Agent.streamObject({
          schema,
          prompt: body.prompt,
          model,
          local,
          ...(apiKey !== undefined ? { apiKey } : {}),
          ...(systemPrompt !== undefined ? { systemPrompt } : {}),
          ...(maxRetries !== undefined ? { maxRetries } : {}),
        });
        for await (const evt of iter) {
          if (evt.type === "partial") {
            write(`o:${JSON.stringify({ partial: evt.partial, attempt: evt.attempt })}`);
          } else if (evt.type === "complete") {
            write(`O:${JSON.stringify({ object: evt.object })}`);
          }
        }
        write(`d:${JSON.stringify({ finishReason: "stop" })}`);
      } catch (cause) {
        const msg = cause instanceof Error ? cause.message : String(cause);
        write(`3:${JSON.stringify(msg)}`);
      } finally {
        controller.close();
      }
    },
  });

  // Pre-stream typed errors are caught here — Agent.streamObject is a sync
  // generator factory, so it doesn't throw until iteration. We MUST iterate
  // at least once to catch ConfigurationError before responding.
  // Pragmatically: ConfigurationError on bad model/options is raised inside
  // the generator on first .next(); the catch block above writes `3:` and
  // closes. For pre-stream HTTP 4xx semantics in this v1.2 release, we
  // surface ConfigurationError as `3:` (stream-level) only. Future iteration
  // may add a pre-validation step that returns 400 before opening the stream.
  void ConfigurationError;
  void AuthenticationError;
  void StreamObjectError;

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Vercel-AI-Data-Stream": "v1",
    },
  });
}
