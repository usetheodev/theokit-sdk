import { AuthenticationError, ConfigurationError, type SDKAgent } from "@usetheo/sdk";

/**
 * Options for {@link streamCompletion}. Server-side handler.
 *
 * @public
 */
export interface StreamCompletionOptions {
  /** SDKAgent obtained via `Agent.getOrCreate` / `createAgentFactory`. */
  agent: SDKAgent;
  /** Request body parsed by the consumer's route handler. */
  body: { prompt: string };
}

/**
 * Convert an SDKAgent send into a streaming HTTP Response that speaks
 * Vercel AI Data Stream v1 (text-only). Equivalent to {@link streamTheoChat}
 * but for single-shot completions — no message history is expected from
 * the caller. EC-2: pre-stream typed errors return JSON 4xx instead of 500.
 *
 * @public
 */
export async function streamCompletion(options: StreamCompletionOptions): Promise<Response> {
  const { agent, body } = options;
  if (typeof body.prompt !== "string" || body.prompt.length === 0) {
    return Response.json({ error: "missing prompt", code: "missing_prompt" }, { status: 400 });
  }

  let run: Awaited<ReturnType<typeof agent.send>>;
  try {
    run = await agent.send(body.prompt);
  } catch (cause) {
    if (cause instanceof ConfigurationError) {
      return Response.json({ error: cause.message, code: cause.code }, { status: 400 });
    }
    if (cause instanceof AuthenticationError) {
      return Response.json({ error: cause.message, code: cause.code }, { status: 401 });
    }
    const message = cause instanceof Error ? cause.message : "internal";
    return Response.json({ error: message, code: "unknown" }, { status: 500 });
  }

  const stream = new ReadableStream({
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: SSE encoder dispatches each SDKMessage type + finish + error inline.
    async start(controller) {
      const enc = new TextEncoder();
      const write = (line: string) => controller.enqueue(enc.encode(`${line}\n`));
      try {
        for await (const evt of run.stream()) {
          if (evt.type === "assistant") {
            const text = evt.message.content
              .filter((c) => c.type === "text")
              .map((c) => c.text)
              .join("");
            if (text.length > 0) write(`0:${JSON.stringify(text)}`);
          }
        }
        const result = await run.wait();
        write(
          `d:${JSON.stringify({
            finishReason: result.status === "finished" ? "stop" : result.status,
          })}`,
        );
      } catch (cause) {
        const msg = cause instanceof Error ? cause.message : String(cause);
        write(`3:${JSON.stringify(msg)}`);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Vercel-AI-Data-Stream": "v1",
    },
  });
}
