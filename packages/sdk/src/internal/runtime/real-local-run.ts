import type { AgentOptions, ModelSelection } from "../../types/agent.js";
import type { Run, RunOperation, RunStatus, SDKUserMessage, SendOptions } from "../../types/run.js";
import { type AgentLoopInputs, runAgentLoop } from "../agent-loop/loop.js";
import { FallbackLlmClient } from "../llm/fallback-client.js";
import { resolveProviderChain } from "../llm/router.js";
import { createMcpClient, type McpClient } from "../mcp/client.js";
import { FixtureRunBase, prepareRunContext } from "./fixture-run-base.js";
import type { FixtureScript } from "./fixture-types.js";
import type { HooksExecutor } from "./hooks-executor.js";
import { registerRun } from "./run-registry.js";

/**
 * Real local Run. When the local agent has a non-fixture API key plus at
 * least one provider env credential, the agent loop drives a real LLM and
 * dispatches real tools. The output is materialized into the same
 * `FixtureScript` shape used by the fixture runtime so the `Run` surface
 * stays uniform.
 *
 * @internal
 */

export interface CreateRealLocalRunOptions {
  agentId: string;
  model: ModelSelection | undefined;
  message: string | SDKUserMessage;
  agentOptions: AgentOptions;
  sendOptions: SendOptions;
  workspaceCwd: string;
  hooks: HooksExecutor;
  /** Pre-resolved system prompt threaded by `LocalAgent.send`. */
  systemPrompt?: string;
  onStep?: SendOptions["onStep"];
  onDelta?: SendOptions["onDelta"];
}

export function createRealLocalRun(options: CreateRealLocalRunOptions): Run {
  const { userText, id, startTime } = prepareRunContext(options.message);
  const supported = new Set<RunOperation>(["stream", "wait", "cancel", "conversation"]);
  const placeholderScript: FixtureScript = {
    events: [],
    finalStatus: "running",
    cancellable: false,
    conversation: [],
  };

  const handle = new RealLocalRun(
    {
      id,
      agentId: options.agentId,
      model: options.model,
      script: placeholderScript,
      supportedOps: supported,
      startTime,
    },
    () => buildLoopInputs(options, id, userText),
  );
  handle.bootstrap();
  registerRun(handle);
  return handle;
}

function buildLoopInputs(
  options: CreateRealLocalRunOptions,
  runId: string,
  userText: string,
): AgentLoopInputs {
  const primary = options.agentOptions.providers?.routes?.[0]?.provider ?? detectPrimaryProvider();
  const fallback = options.agentOptions.providers?.fallback;
  const chain = resolveProviderChain({
    primary,
    ...(fallback !== undefined ? { fallback } : {}),
  });
  const llm =
    chain.length === 1 ? (chain[0] as (typeof chain)[number]) : new FallbackLlmClient(chain);
  return {
    agentId: options.agentId,
    runId,
    model: options.model ?? { id: "claude-sonnet-4-6" },
    userMessage: userText,
    llm,
    mcp: buildMcpMap(options),
    hooks: options.hooks,
    shellCwd: options.workspaceCwd,
    shellSandbox: options.agentOptions.local?.sandboxOptions?.enabled === true,
    ...(options.systemPrompt !== undefined ? { systemPrompt: options.systemPrompt } : {}),
    ...(options.onStep !== undefined ? { onStep: options.onStep } : {}),
    ...(options.onDelta !== undefined ? { onDelta: options.onDelta } : {}),
  };
}

function detectPrimaryProvider(): string {
  if (process.env.ANTHROPIC_API_KEY !== undefined && process.env.ANTHROPIC_API_KEY.length > 0) {
    return "anthropic";
  }
  if (process.env.OPENAI_API_KEY !== undefined && process.env.OPENAI_API_KEY.length > 0) {
    return "openai";
  }
  if (process.env.OPENROUTER_API_KEY !== undefined && process.env.OPENROUTER_API_KEY.length > 0) {
    return "openrouter";
  }
  return "openai";
}

function buildMcpMap(options: CreateRealLocalRunOptions): Map<string, McpClient> {
  const map = new Map<string, McpClient>();
  const inline = options.sendOptions.mcpServers ?? options.agentOptions.mcpServers;
  if (inline === undefined) return map;
  for (const [name, config] of Object.entries(inline)) {
    map.set(name, createMcpClient(name, config));
  }
  return map;
}

class RealLocalRun extends FixtureRunBase {
  private readonly buildInputs: () => AgentLoopInputs;

  constructor(
    options: ConstructorParameters<typeof FixtureRunBase>[0],
    buildInputs: () => AgentLoopInputs,
  ) {
    super(options);
    this.buildInputs = buildInputs;
  }

  bootstrap(): void {
    setTimeout(() => {
      void this.driveLoop();
    }, 0);
  }

  protected override notifyImmediately(): boolean {
    return true;
  }

  private async driveLoop(): Promise<void> {
    if (this.terminated) return;
    const inputs = this.tryBuildInputs();
    if (inputs === undefined) return;
    await this.initializeMcp(inputs);
    await this.executeAgentLoop(inputs);
  }

  private tryBuildInputs(): AgentLoopInputs | undefined {
    try {
      return this.buildInputs();
    } catch (cause) {
      this.emitErrorEvent(cause, "Failed to build agent loop inputs");
      this.transitionTo("error" satisfies RunStatus);
      return undefined;
    }
  }

  private async initializeMcp(inputs: AgentLoopInputs): Promise<void> {
    for (const [name, client] of inputs.mcp.entries()) {
      try {
        await client.initialize();
      } catch (cause) {
        this.emitErrorEvent(
          cause,
          `MCP server ${name} failed to initialize`,
          `MCP server ${name} failed to initialize: `,
        );
      }
    }
  }

  private async executeAgentLoop(inputs: AgentLoopInputs): Promise<void> {
    try {
      const output = await runAgentLoop(inputs);
      for (const event of output.events) {
        this.script.events.push(event);
        this.notifyNewEvents();
      }
      this.script.conversation.push(...output.conversation);
      if (output.result.length > 0) this.script.result = output.result;
      this.transitionTo(output.finalStatus);
    } catch (cause) {
      this.emitErrorEvent(cause, "Agent loop failed");
      this.transitionTo("error" satisfies RunStatus);
    } finally {
      for (const client of inputs.mcp.values()) {
        await client.close().catch(() => undefined);
      }
    }
  }

  private emitErrorEvent(cause: unknown, fallback: string, prefix = ""): void {
    const message = cause instanceof Error ? cause.message : String(cause);
    this.script.events.push({
      type: "assistant",
      agent_id: this.agentId,
      run_id: this.id,
      message: {
        role: "assistant",
        content: [
          {
            type: "text",
            text: prefix.length > 0 ? `${prefix}${message}` : message || fallback,
          },
        ],
      },
    });
    this.notifyNewEvents();
  }
}
