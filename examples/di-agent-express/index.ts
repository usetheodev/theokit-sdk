/**
 * Dogfood: minimal HTTP server demonstrating `@InjectAgent` + REQUEST-scoped
 * Agent isolation per request. Each incoming HTTP request gets its own Agent
 * instance, isolated from concurrent requests' Agents. On graceful shutdown,
 * the container disposes every singleton in reverse construction order.
 *
 * Run:
 *   OPENROUTER_API_KEY=... pnpm start
 *
 * Probe (in another shell):
 *   curl 'http://localhost:3030/chat?message=Reply%20PONG'
 *   curl 'http://localhost:3030/chat?message=Say%20hi'  &  (parallel)
 *   curl 'http://localhost:3030/chat?message=Three'    &
 *
 * Look for `[di-agent-express] AGENT created id=<n>` in stderr — every
 * request should get a different id. On Ctrl+C, you should see
 * `[di-agent-express] container disposed` and zero leaks.
 *
 * v1.2 EC-15 DOCUMENT: wrap the ENTIRE handler in runInRequest. Avoid
 * setImmediate / setTimeout callbacks that escape the Promise chain —
 * AsyncLocalStorage doesn't propagate to those.
 */
import "reflect-metadata";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { Container, Injectable, Module, Scope } from "@theokit/di";
import { InjectAgent, createAgentProvider } from "@theokit/di-agent";
import { Agent, type SDKAgent } from "@theokit/sdk";

const KEY = process.env.OPENROUTER_API_KEY;
if (KEY === undefined || KEY.length === 0) {
  console.error("OPENROUTER_API_KEY is required. Set it before running.");
  process.exit(1);
}

const MODEL = process.env.DI_AGENT_EXPRESS_MODEL ?? "openai/gpt-4o-mini";
const PORT = Number.parseInt(process.env.PORT ?? "3030", 10);

let agentCounter = 0;

async function makeAgent(): Promise<SDKAgent> {
  agentCounter += 1;
  const id = agentCounter;
  process.stderr.write(`[di-agent-express] AGENT created id=${id}\n`);
  const agent = await Agent.create({
    apiKey: KEY!,
    model: { id: MODEL },
    providers: { routes: [{ capability: "chat", provider: "openrouter" }] },
  });
  // Attach our id for log correlation.
  (agent as unknown as { _exampleId: number })._exampleId = id;
  return agent;
}

// IMPORTANT: ChatService MUST be REQUEST-scoped because it depends on
// the REQUEST-scoped Agent. Mixing scopes (SINGLETON consumer of a REQUEST
// dep) freezes a stale reference at the first resolve — when that request
// completes and disposes the Agent, subsequent requests see "Agent has
// been disposed" via the cached singleton.
// v1 leaves scope propagation as a consumer responsibility (NestJS upgrades
// SINGLETON→REQUEST automatically; v2 may follow). For now: opt the
// consumer into REQUEST scope explicitly.
@Injectable({ scope: Scope.REQUEST })
class ChatService {
  constructor(@InjectAgent() readonly agent: SDKAgent) {}

  async chat(message: string): Promise<{ id: number; reply: string }> {
    const run = await this.agent.send(message);
    let reply = "";
    for await (const event of run.stream()) {
      if (event.type === "assistant") {
        for (const part of event.message.content) {
          if (part.type === "text") reply += part.text;
        }
      }
    }
    await run.wait();
    const id = (this.agent as unknown as { _exampleId: number })._exampleId;
    return { id, reply };
  }
}

@Module({
  providers: [createAgentProvider({ factory: () => makeAgent() }), ChatService],
})
class AppModule {}

const container = new Container();
container.registerModule(AppModule);

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    if (url.pathname !== "/chat") {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Try /chat?message=<text>");
      return;
    }
    const message = url.searchParams.get("message") ?? "Say hello.";

    // CRITICAL (v1.2 EC-15): wrap the entire handler in runInRequest so
    // AsyncLocalStorage propagates through all async continuations.
    const result = await container.runInRequest(async () => {
      const chat = await container.resolveAsync(ChatService);
      return chat.chat(message);
    });

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ agentId: result.id, reply: result.reply }));
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(err instanceof Error ? err.message : "Internal error");
  }
});

server.listen(PORT, () => {
  process.stderr.write(`[di-agent-express] listening on http://localhost:${PORT}\n`);
});

async function shutdown(signal: string): Promise<void> {
  process.stderr.write(`[di-agent-express] ${signal} received, shutting down...\n`);
  server.close();
  await container.dispose();
  process.stderr.write(`[di-agent-express] container disposed\n`);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
