import { ConfigurationError } from "../../../errors.js";
import type { AgentOptions, CustomTool, ModelSelection } from "../../../types/agent.js";
import type {
  Run,
  RunOperation,
  RunStatus,
  SDKUserMessage,
  SendOptions,
} from "../../../types/run.js";
import { type AgentLoopInputs, runAgentLoop } from "../../agent-loop/loop.js";
import type { CustomToolSpec, MemoryToolSpec } from "../../agent-loop/loop-types.js";
import { LOCAL_RUNTIME_MOCK_KEY } from "../../auth/api-key-validator.js";
import { isFixtureApiKey } from "../../fixture-mode.js";
import { FallbackLlmClient } from "../../llm/fallback-client.js";
import { parseModelId } from "../../llm/model-identifier.js";
import { resolveProviderChain } from "../../llm/router.js";
import { createMcpClient, type McpClient } from "../../mcp/client.js";
import { getProviderProfile, registerBuiltins } from "../../providers/index.js";
import { registerPluginProviderProfiles } from "../../providers/register-plugin-providers.js";
import { createTelemetry } from "../../telemetry/tracer.js";
import { applyPersonalityFilter } from "../../tool-registry/personality-filter.js";
import { FixtureRunBase, prepareRunContext } from "../fixtures/fixture-run-base.js";
import type { FixtureScript } from "../fixtures/fixture-types.js";
import type { HooksExecutor } from "../hooks/hooks-executor.js";
import { registerRun } from "../registry/run-registry.js";
import type { SessionMessage } from "../session/agent-session.js";

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
  /** T4.1 — PluginManager threaded from LocalAgent for plugin tools + pre_tool_call hooks. */
  pluginManager?: import("../../plugins/manager.js").PluginManager;
  /** Pre-resolved system prompt threaded by `LocalAgent.send`. */
  systemPrompt?: string;
  onStep?: SendOptions["onStep"];
  onDelta?: SendOptions["onDelta"];
  /** Prior conversation history (excluding the current user message). */
  priorMessages?: ReadonlyArray<SessionMessage>;
  /** Memory tools to register with the LLM (Phase 6 of memory-system-openclaw-parity). */
  memoryTools?: ReadonlyArray<MemoryToolSpec>;
  /**
   * Active personality tool whitelist (T4.1, ADR D167). When defined,
   * `customTools` are filtered to this subset; missing entries log a
   * one-shot warn. Undefined = no filter.
   */
  personalityToolWhitelist?: ReadonlyArray<string>;
  /** Active personality slug — used in personality-filter warnings. */
  personalityName?: string;
}

export function createRealLocalRun(options: CreateRealLocalRunOptions): Run {
  const { userText, id, startTime } = prepareRunContext(options.message);
  const supported = new Set<RunOperation>(["stream", "wait", "cancel", "conversation"]);
  // The base Run class accepts a FixtureScript for shape; the real LLM
  // run never consumes it because `buildLoopInputs` drives the real agent
  // loop instead of replaying events. Empty script keeps the type honest.
  const unusedFixtureScript: FixtureScript = {
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
      script: unusedFixtureScript,
      supportedOps: supported,
      startTime,
    },
    () => buildLoopInputs(options, id, userText),
  );
  handle.bootstrap();
  registerRun(handle);
  return handle;
}

// Module-level one-shot: the observability line fires once per process, not
// once per run, to avoid log spam when many agents are created.
let pluginProvidersAnnounced = false;

/** Test-only reset for the one-shot announcement. @internal */
export function _resetPluginProviderAnnounce(): void {
  pluginProvidersAnnounced = false;
}

/**
 * Resolve the run's primary provider + effective model id.
 *
 * Registers builtins AND any plugin-contributed `kind: "model-provider"`
 * profiles FIRST, so the prefix-inference lookup (`model: { id: "myprov/..." }`)
 * can see a plugin-supplied provider. The aggregated profiles were otherwise
 * never registered (half-wired path). Extracted from `buildLoopInputs` (SRP)
 * and exported `@internal` so the plugin-provider wiring is regression-covered.
 *
 * ADR D182 / T1.2: explicit `providers.routes[0].provider` wins, then prefix
 * inference, then env-var heuristics (`detectPrimaryProvider`).
 *
 * @internal
 */
export function resolveRunProvider(options: CreateRealLocalRunOptions): {
  primary: string;
  effectiveModelId: string;
} {
  registerBuiltins();
  const profiles = options.pluginManager?.aggregated.providerProfiles ?? [];
  const registered = registerPluginProviderProfiles(profiles);
  // Wiring-triad pillar (c): one-shot observability that plugin providers were
  // wired this process. Silent on the zero-plugin happy path.
  if (registered > 0 && !pluginProvidersAnnounced) {
    pluginProvidersAnnounced = true;
    const names = profiles.map((e) => e.profile.name).join(", ");
    process.stderr.write(
      `[theokit-sdk] registered ${registered} plugin provider profile(s): ${names}\n`,
    );
  }
  const parsedModel = parseModelId(options.model?.id);
  const modelInferredProvider =
    parsedModel.provider !== undefined && getProviderProfile(parsedModel.provider) !== undefined
      ? parsedModel.provider
      : undefined;
  // M4 (plan m4-provider-routing-apikey-fix): the explicitly-passed API key is
  // the ground-truth credential of which endpoint will be called, so it outranks
  // model-prefix inference for `primary` — a `sk-or-` key + an `openai/gpt-4o-mini`
  // model MUST route to OpenRouter, not the OpenAI provider. An explicit
  // `providers.routes[0].provider` still wins (user override).
  const keyInferredProvider = inferProviderFromApiKey(options.agentOptions.apiKey);
  const primary =
    options.agentOptions.providers?.routes?.[0]?.provider ??
    keyInferredProvider ??
    modelInferredProvider ??
    detectPrimaryProvider();
  // Strip the vendor prefix ONLY when the model's own prefix names the resolved
  // primary (anthropic/claude → claude for the anthropic provider). When primary
  // is an aggregator (openrouter) whose slug legitimately embeds a `vendor/`
  // segment (openai/gpt-4o-mini), pass the id through unstripped.
  const effectiveModelId =
    modelInferredProvider !== undefined && modelInferredProvider === primary
      ? parsedModel.name
      : (options.model?.id ?? "claude-sonnet-4-6");
  return { primary, effectiveModelId };
}

/**
 * M4: infer the provider from an explicitly-passed API key prefix. Reuses the
 * KNOWN_PROVIDER_PREFIXES mapping (`api-key-validator.ts`) — longest prefix wins
 * so `sk-or-` (openrouter) / `sk-ant-` (anthropic) are matched before `sk-`
 * (openai). Returns `undefined` for fixture / `local` / empty keys and for
 * providers that are not registered. @internal
 */
function inferProviderFromApiKey(apiKey: string | undefined): string | undefined {
  if (apiKey === undefined || apiKey.length === 0) return undefined;
  const byPrefix: ReadonlyArray<{ provider: string; prefix: string }> = [
    { provider: "openrouter", prefix: "sk-or-" },
    { provider: "anthropic", prefix: "sk-ant-" },
    { provider: "openai", prefix: "sk-" },
  ];
  for (const { provider, prefix } of byPrefix) {
    if (apiKey.startsWith(prefix) && getProviderProfile(provider) !== undefined) {
      return provider;
    }
  }
  return undefined;
}

/**
 * M4: thread the single `Agent.create({ apiKey })` credential into the router's
 * per-provider pool for the resolved `primary`, so an explicitly-passed key is
 * used even when the matching env var is unset. An existing `providers.apiKeys`
 * pool for the provider wins (it is the more-specific config); fixture and
 * `local` sentinels are never threaded (they are not real credentials). @internal
 */
export function mergeExplicitApiKey(
  pools: Record<string, string[]> | undefined,
  primary: string,
  apiKey: string | undefined,
): Record<string, string[]> | undefined {
  if (apiKey === undefined || apiKey.length === 0) return pools;
  if (isFixtureApiKey(apiKey) || apiKey === LOCAL_RUNTIME_MOCK_KEY) return pools;
  const existing = pools?.[primary];
  if (existing !== undefined && existing.length > 0) return pools;
  return { ...(pools ?? {}), [primary]: [apiKey] };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: spread-conditional builders for optional fields (systemPrompt, onStep, onDelta, priorMessages, memoryTools, customTools, pluginManager) are the canonical pattern for shaping AgentLoopInputs; splitting hurts readability.
function buildLoopInputs(
  options: CreateRealLocalRunOptions,
  runId: string,
  userText: string,
): AgentLoopInputs {
  // M1-2: per-send iteration ceiling. Validate at the boundary so an invalid
  // knob fails fast with a clear message instead of producing a degenerate budget.
  const maxIterations = options.sendOptions.maxIterations;
  if (maxIterations !== undefined && (!Number.isInteger(maxIterations) || maxIterations < 1)) {
    throw new ConfigurationError(
      `SendOptions.maxIterations must be a positive integer, got ${maxIterations}`,
      { code: "invalid_max_iterations" },
    );
  }
  const { primary, effectiveModelId } = resolveRunProvider(options);
  const fallback = options.agentOptions.providers?.fallback;
  // M4: thread the single explicit `apiKey` into the pool for `primary` so an
  // explicitly-passed credential is used even without the matching env var.
  const apiKeys = mergeExplicitApiKey(
    options.agentOptions.providers?.apiKeys,
    primary,
    options.agentOptions.apiKey,
  );
  const credentialPoolStrategy = options.agentOptions.providers?.credentialPoolStrategy;
  // theokit#58 follow-up: the chat route may opt into leaked-dialect recovery.
  // Mirrors how `primary` derives from routes[0]; applied to the resolved chain.
  const extractToolCallsFromContent =
    options.agentOptions.providers?.routes?.[0]?.extractToolCallsFromContent;
  const chain = resolveProviderChain({
    primary,
    ...(fallback !== undefined ? { fallback } : {}),
    ...(apiKeys !== undefined ? { apiKeys } : {}),
    ...(credentialPoolStrategy !== undefined ? { credentialPoolStrategy } : {}),
    ...(extractToolCallsFromContent === true ? { extractToolCallsFromContent: true } : {}),
  });
  const llm =
    chain.length === 1 ? (chain[0] as (typeof chain)[number]) : new FallbackLlmClient(chain);
  return {
    agentId: options.agentId,
    runId,
    // issue #47: carry ModelSelection.params (the reasoning `thinking` param) into the loop so the
    // request can forward reasoning. The id is stripped/normalized above; params pass through as-is.
    model: {
      id: effectiveModelId,
      ...(options.model?.params !== undefined ? { params: options.model.params } : {}),
    },
    userMessage: userText,
    llm,
    mcp: buildMcpMap(options),
    hooks: options.hooks,
    shellCwd: options.workspaceCwd,
    shellSandbox: options.agentOptions.local?.sandboxOptions?.enabled === true,
    ...(options.systemPrompt !== undefined ? { systemPrompt: options.systemPrompt } : {}),
    ...(options.onStep !== undefined ? { onStep: options.onStep } : {}),
    ...(options.onDelta !== undefined ? { onDelta: options.onDelta } : {}),
    ...(options.sendOptions.toolChoice !== undefined
      ? { toolChoice: options.sendOptions.toolChoice }
      : {}),
    ...(options.priorMessages !== undefined ? { priorMessages: options.priorMessages } : {}),
    ...(options.memoryTools !== undefined && options.memoryTools.length > 0
      ? { memoryTools: options.memoryTools }
      : {}),
    ...buildCustomToolsInput(
      options.agentOptions,
      options.sendOptions,
      options.pluginManager,
      options.personalityToolWhitelist,
      options.agentId,
      options.personalityName,
    ),
    ...(options.pluginManager !== undefined ? { pluginManager: options.pluginManager } : {}),
    // D318 — forward SendOptions.signal to the agent loop so streamLlmTurn
    // can attach it to the LLM `fetch({ signal })` call.
    ...(options.sendOptions.signal !== undefined ? { signal: options.sendOptions.signal } : {}),
    // M7 — forward SendOptions.context to the loop so every tool handler receives
    // it on `ctx.context` (shared run config set once, e.g. projectRoot).
    ...(options.sendOptions.context !== undefined ? { context: options.sendOptions.context } : {}),
    // #58 / #57 — forward the per-tool timeout + tool-result guard so a consumer
    // can enable them via SendOptions (not only internal AgentLoopInputs).
    ...(options.sendOptions.perToolTimeoutMs !== undefined
      ? { perToolTimeoutMs: options.sendOptions.perToolTimeoutMs }
      : {}),
    ...(options.sendOptions.toolResultGuard !== undefined
      ? { toolResultGuard: options.sendOptions.toolResultGuard }
      : {}),
    // M1-2: per-send iteration ceiling (validated above). The loop reads
    // inputs.maxIterations (default 8 when unset).
    ...(maxIterations !== undefined ? { maxIterations } : {}),
    // Doom-loop guard config (default on; `false` disables, object tunes thresholds).
    ...(options.sendOptions.doomLoop !== undefined
      ? { doomLoop: options.sendOptions.doomLoop }
      : {}),
    // D315-D317 — tool lifecycle hooks (cost tracking + audit + retry/alert)
    ...(options.agentOptions.onToolStart !== undefined
      ? { onToolStart: options.agentOptions.onToolStart }
      : {}),
    ...(options.agentOptions.onToolEnd !== undefined
      ? { onToolEnd: options.agentOptions.onToolEnd }
      : {}),
    ...(options.agentOptions.onToolError !== undefined
      ? { onToolError: options.agentOptions.onToolError }
      : {}),
    telemetry: createTelemetry(options.agentOptions.telemetry),
    // SDK 2.0 Phase 2 / T2.1: thread the optional BudgetTracker from
    // Agent.create options down to the loop. Runtime `track()` / `check()`
    // calls land in a follow-up iteration; for now the field is plumbed
    // so future enablement requires no further type changes.
    ...(options.agentOptions.budgetTracker !== undefined
      ? { budgetTracker: options.agentOptions.budgetTracker }
      : {}),
    // SDK 2.0 Phase 1 / T1.4: thread the optional MemoryProvider from
    // Agent.create options down to the loop. Runtime `init()` /
    // `buildTools()` / `runActivePass()` / `dispose()` calls land in
    // T1.5; for now the field is plumbed so the runtime wiring requires
    // no further type changes.
    ...(options.agentOptions.memoryProvider !== undefined
      ? { memoryProvider: options.agentOptions.memoryProvider }
      : {}),
  };
}

/**
 * Resolve the effective custom-tool catalog for this run.
 *
 * Precedence (matches the mcpServers semantics — "fully replaces, not merged"):
 *  - `sendOptions.tools === undefined` → fall back to `agentOptions.tools`
 *  - `sendOptions.tools = []`         → explicitly clear (no custom tools)
 *  - `sendOptions.tools = [t1, ...]`  → use exactly these for this run
 */
function buildCustomToolsInput(
  agentOptions: AgentOptions,
  sendOptions: { tools?: CustomTool[] } | undefined,
  pluginManager: import("../../plugins/manager.js").PluginManager | undefined,
  personalityToolWhitelist: ReadonlyArray<string> | undefined,
  agentId: string,
  personalityName: string | undefined,
): { customTools: ReadonlyArray<CustomToolSpec> } | Record<string, never> {
  const baseTools = sendOptions?.tools ?? agentOptions.tools ?? [];
  // T4.1: concat plugin-registered tools onto the effective catalog. Plugin
  // tools are merged unconditionally (no override semantics — name collision
  // would be caught by the registry validator if used).
  const pluginTools = pluginManager?.aggregated.tools ?? [];
  if (baseTools.length === 0 && pluginTools.length === 0) return {};
  const merged: CustomToolSpec[] = [...baseTools, ...pluginTools].map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    handler: tool.handler,
  }));
  // Phase 4.1 / ADR D167 — advisory narrowing by active personality.
  const customTools = applyPersonalityFilter(merged, personalityToolWhitelist, {
    agentId,
    personalityName,
  }) as ReadonlyArray<CustomToolSpec>;
  if (customTools.length === 0 && personalityToolWhitelist === undefined) return {};
  return { customTools };
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
      this.emitErrorEvent(cause, "Failed to build agent loop inputs", "", "build_inputs_failed");
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
          "mcp_init_failed",
        );
      }
    }
  }

  private async executeAgentLoop(inputs: AgentLoopInputs): Promise<void> {
    try {
      const output = await runAgentLoop(inputs);
      this.applyAgentLoopOutput(output);
      this.transitionTo(output.finalStatus);
    } catch (cause) {
      this.emitErrorEvent(cause, "Agent loop failed", "", "agent_loop_failed");
      this.transitionTo("error" satisfies RunStatus);
    } finally {
      for (const client of inputs.mcp.values()) {
        await client.close().catch(() => undefined);
      }
    }
  }

  /**
   * Copy runAgentLoop output into the script (events + conversation +
   * usage/cost + errorDetail). Extracted to keep executeAgentLoop below
   * the complexity-10 cap (D422 / sdk-biome-cleanup-plan).
   *
   * D376/D377: usage/cost surfaced for RunResult.usage / RunResult.cost.
   * Finding-B fix (sdk-error-packaging v1.1): set-once errorDetail copy.
   */
  private applyAgentLoopOutput(output: Awaited<ReturnType<typeof runAgentLoop>>): void {
    for (const event of output.events) {
      this.script.events.push(event);
      this.notifyNewEvents();
    }
    this.script.conversation.push(...output.conversation);
    if (output.result.length > 0) this.script.result = output.result;
    if (output.usage !== undefined) this.script.usage = output.usage;
    if (output.cost !== undefined) this.script.cost = output.cost;
    // M1-2 (T2.2): surface the silent-truncation signal onto the RunResult.
    if (output.stoppedAtIterationLimit === true) this.script.stoppedAtIterationLimit = true;
    // Doom-loop guard: surface the identical-repeat stop signal onto the RunResult.
    if (output.stoppedByDoomLoop === true) this.script.stoppedByDoomLoop = true;
    if (output.error !== undefined && this.script.errorDetail === undefined) {
      this.script.errorDetail = {
        message: output.error.message,
        ...(output.error.code !== undefined ? { code: output.error.code } : {}),
        cause: output.error.cause,
      };
    }
  }

  private emitErrorEvent(cause: unknown, fallback: string, prefix = "", code?: string): void {
    // Finding-B fix (sdk-error-packaging-fix-plan v1.1): surface infra
    // failures (MCP init, build-inputs, agent_loop_failed outer-catch) via
    // the structured `errorDetail` channel ONLY — never as assistant
    // content. Downstream `buildResult()` copies this onto RunResult.error,
    // and `Run.stream()` will emit a typed `{ type: "error" }` event when
    // the runtime observes errorDetail (Phase 2). Set-once.
    if (this.script.errorDetail === undefined) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const display = prefix.length > 0 ? `${prefix}${message}` : message || fallback;
      this.script.errorDetail = {
        message: display,
        ...(code !== undefined ? { code } : {}),
        cause,
      };
    }
    this.notifyNewEvents();
  }
}
