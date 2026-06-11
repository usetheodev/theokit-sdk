import { Container, Injectable, Module, Scope, ScopeViolationError } from "@theokit/di";
import { describe, expect, it } from "vitest";

import { AGENT_TOKEN, createAgentProvider, InjectAgent } from "../src/index.js";

// ─────────────────────────────────────────────────────────────────────
// T4.1 — di-agent unit tests (mock Agent — real-LLM test is T4.2)
// ─────────────────────────────────────────────────────────────────────

/**
 * Minimal Agent stub for unit tests. The full Agent contract lives in
 * @theokit/sdk; we just need an object that proves DI wires it correctly.
 */
interface AgentLike {
  readonly id: number;
  send(message: string): { reply: string; agentId: number };
}

let agentCounter = 0;
function makeAgentStub(): AgentLike {
  agentCounter += 1;
  const id = agentCounter;
  return {
    id,
    send(message: string) {
      return { reply: `echo:${message}`, agentId: id };
    },
  };
}

describe("InjectAgent + createAgentProvider", () => {
  it("InjectAgent resolves the Agent provided via createAgentProvider", async () => {
    @Injectable()
    class ChatService {
      constructor(@InjectAgent() readonly agent: AgentLike) {}
    }

    @Module({
      providers: [createAgentProvider<AgentLike>({ factory: () => makeAgentStub() }), ChatService],
    })
    class AppModule {}

    const c = new Container();
    c.registerModule(AppModule);

    const result = await c.runInRequest(async () => {
      const svc = await c.resolveAsync(ChatService);
      return svc.agent.send("hi");
    });

    expect(result.reply).toBe("echo:hi");
  });

  it("createAgentProvider defaults to REQUEST scope (each request gets a new Agent)", async () => {
    @Module({ providers: [createAgentProvider<AgentLike>({ factory: () => makeAgentStub() })] })
    class AppModule {}

    const c = new Container();
    c.registerModule(AppModule);

    const a = await c.runInRequest(async () => c.resolveAsync<AgentLike>(AGENT_TOKEN));
    const b = await c.runInRequest(async () => c.resolveAsync<AgentLike>(AGENT_TOKEN));

    expect(a.id).not.toBe(b.id);
  });

  it("createAgentProvider scope=SINGLETON shares one Agent across requests", async () => {
    @Module({
      providers: [
        createAgentProvider<AgentLike>({
          factory: () => makeAgentStub(),
          scope: Scope.SINGLETON,
        }),
      ],
    })
    class AppModule {}

    const c = new Container({ allowDynamicRegistration: false });
    c.registerModule(AppModule);

    const a = await c.resolveAsync<AgentLike>(AGENT_TOKEN);
    const b = await c.resolveAsync<AgentLike>(AGENT_TOKEN);

    expect(a.id).toBe(b.id);
  });

  it("InjectAgent outside runInRequest throws ScopeViolationError (REQUEST default)", async () => {
    @Injectable()
    class ChatService {
      constructor(@InjectAgent() readonly agent: AgentLike) {}
    }
    @Module({
      providers: [createAgentProvider<AgentLike>({ factory: () => makeAgentStub() }), ChatService],
    })
    class AppModule {}

    const c = new Container();
    c.registerModule(AppModule);

    await expect(c.resolveAsync(ChatService)).rejects.toBeInstanceOf(ScopeViolationError);
  });

  it("Each runInRequest gets an isolated Agent — REQUEST cache + Promise-lock pin shared", async () => {
    @Module({ providers: [createAgentProvider<AgentLike>({ factory: () => makeAgentStub() })] })
    class AppModule {}

    const c = new Container();
    c.registerModule(AppModule);

    const ids = await Promise.all([
      c.runInRequest(async () => (await c.resolveAsync<AgentLike>(AGENT_TOKEN)).id),
      c.runInRequest(async () => (await c.resolveAsync<AgentLike>(AGENT_TOKEN)).id),
      c.runInRequest(async () => (await c.resolveAsync<AgentLike>(AGENT_TOKEN)).id),
    ]);

    // All three IDs distinct.
    expect(new Set(ids).size).toBe(3);
  });
});
