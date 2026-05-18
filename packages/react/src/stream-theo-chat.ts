import { AuthenticationError, ConfigurationError, type SDKAgent } from "@usetheo/sdk";

/**
 * Options for {@link streamTheoChat}.
 *
 * @public
 */
export interface StreamTheoChatOptions {
  /** SDKAgent (typically obtained via `Agent.getOrCreate` or `createAgentFactory`). */
  agent: SDKAgent;
  /** Request body parsed from the consumer's route handler. */
  body: { agentId: string; messages: Array<{ role: "user" | "assistant"; content: string }> };
}

/**
 * Convert an SDKAgent send into a streaming HTTP Response that speaks
 * Vercel AI Data Stream v1 (see wire-format.md). EC-2: synchronous errors
 * during `agent.send` produce a JSON HTTP response with the appropriate
 * status code BEFORE any SSE stream is opened — so consumers see typed
 * errors instead of an unhandled HTTP 500.
 *
 * @public
 */
export async function streamTheoChat(options: StreamTheoChatOptions): Promise<Response> {
  const { agent, body } = options;
  // Take the LAST user message as the prompt to send. Earlier turns live
  // in the agent's session history (D17-D21 persistence).
  const lastUser = [...body.messages].reverse().find((m) => m.role === "user");
  if (lastUser === undefined) {
    return Response.json(
      { error: "no user message", code: "missing_user_message" },
      { status: 400 },
    );
  }

  // EC-2 mitigation: agent.send may reject SYNCHRONOUSLY with typed errors
  // BEFORE the stream starts. We must surface those as HTTP errors with the
  // appropriate status, not a silent 500.
  let run: Awaited<ReturnType<typeof agent.send>>;
  try {
    run = await agent.send(lastUser.content);
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
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: SSE encoder must dispatch every SDKMessage variant inline (text delta / tool_call running / tool_call completed / finish / error); refactoring into per-variant emitters would obscure the wire-format mapping.
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
          } else if (evt.type === "tool_call") {
            if (evt.status === "running") {
              write(`9:${JSON.stringify({ toolCallId: evt.call_id, toolName: evt.name })}`);
            } else if (evt.status === "completed") {
              const result = (evt as { result?: { stdout?: string } }).result;
              write(
                `a:${JSON.stringify({ toolCallId: evt.call_id, result: result?.stdout ?? "" })}`,
              );
            }
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
