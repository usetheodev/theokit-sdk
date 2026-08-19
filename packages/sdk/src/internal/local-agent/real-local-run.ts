import { ConfigurationError } from "../../errors.js";
import type { AgentDefinition, AgentOptions, ModelSelection } from "../../types/agent.js";
import type { SDKMessage } from "../../types/messages.js";
import type { Run, RunOperation, RunStatus, SDKUserMessage, SendOptions } from "../../types/run.js";
import { emitRunEvent } from "../../types/run-events.js";
import { type AgentLoopInputs, runAgentLoop } from "../agent-loop/loop.js";
import type { MemoryToolSpec } from "../agent-loop/loop-types.js";
import { LOCAL_RUNTIME_MOCK_KEY } from "../auth/api-key-validator.js";
import { diag } from "../diagnostics.js";
import { FallbackLlmClient } from "../llm/fallback-client.js";
import { parseModelId } from "../llm/model-identifier.js";
import { resolveProviderChain } from "../llm/router.js";
import { createMcpClient, type McpClient } from "../mcp/client.js";
import { getProviderProfile, registerBuiltins } from "../providers/index.js";
import { registerPluginProviderProfiles } from "../providers/register-plugin-providers.js";
import { withToolWhitelist } from "../runtime/concurrency/async-local-storage.js";
import {
  type InheritedCredentials,
  withInheritedSubAgentCredentials,
} from "../runtime/concurrency/subagent-credentials.js";
import { isFixtureApiKey } from "../runtime/fixtures/fixture-mode.js";
import { FixtureRunBase, prepareRunContext } from "../runtime/fixtures/fixture-run-base.js";
import type { FixtureScript } from "../runtime/fixtures/fixture-types.js";
import type { HooksExecutor } from "../runtime/hooks/hooks-executor.js";
import { registerRun } from "../runtime/registry/run-registry.js";
import type { SessionMessage } from "../session/index.js";
import { createTelemetry } from "../telemetry/tracer.js";
import { McpClientPool } from "./mcp-pool.js";
import { detectPrimaryProvider, inferProviderFromApiKey } from "./real-local-run-provider.js";
import { buildCustomToolsInput, resolveInheritedCredentials } from "./real-local-run-tools.js";

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
  /**
   * File-based + inline subagents merged by `loadSubagents` (`.theokit/agents/*.md`
   * plus `agentOptions.agents`). When present, these — not just the inline
   * `agentOptions.agents` — become the delegation toolset, so a subagent defined
   * only on disk is callable against a real model (not fixture-only).
   */
  subagents?: Record<string, AgentDefinition>;
  sendOptions: SendOptions;
  workspaceCwd: string;
  hooks: HooksExecutor;
  /** T4.1 — PluginManager threaded from LocalAgent for plugin tools + pre_tool_call hooks. */
  pluginManager?: import("../plugins/manager.js").PluginManager;
  /** Pre-resolved system prompt threaded by `LocalAgent.send`. */
  systemPrompt?: string;
  onStep?: SendOptions["onStep"];
  onDelta?: SendOptions["onDelta"];
  /** Prior conversation history (excluding the current user message). */
  priorMessages?: ReadonlyArray<SessionMessage>;
  /** Memory tools to register with the LLM (Phase 6 of memory-system-peer-project-parity). */
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
  const { userText, userImages, id, startTime } = prepareRunContext(options.message);
  const supported = new Set<RunOperation>(["stream", "wait", "cancel", "conversation"]);
  // The base Run class accepts a FixtureScript for shape; the real LLM run does
  // not REPLAY it (`buildLoopInputs` drives the real agent loop instead of
  // replaying events) — but result-metadata fields set here (SE3 `origin`) ARE
  // read back by `buildResult → applyScriptMetrics` and surface on RunResult.
  // So this is the run's result-metadata script, not a throwaway.
  const runScript: FixtureScript = {
    events: [],
    finalStatus: "running",
    cancellable: false,
    conversation: [],
    // SE3 — carry the turn's provenance so buildResult forwards it onto RunResult.origin.
    ...(options.sendOptions.origin !== undefined ? { origin: options.sendOptions.origin } : {}),
  };

  const handle = new RealLocalRun(
    {
      id,
      agentId: options.agentId,
      model: options.model,
      script: runScript,
      supportedOps: supported,
      startTime,
    },
    () => buildLoopInputs(options, id, userText, userImages),
    runOwnsMcpClients(options.agentOptions),
    resolveInheritedCredentials(options.agentOptions),
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
    diag(`[theokit-sdk] registered ${registered} plugin provider profile(s): ${names}\n`);
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
  userImages: import("../../types/run.js").SDKUserMessage["images"],
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
  // SE2 — when the caller subscribed via `onRunEvent`, a 429 retry surfaces a
  // typed `rate_limit` RunEvent (the pool-aware client calls this before backing off).
  const rateLimitSink = options.sendOptions.onRunEvent;
  // #332 — the model's own endpoint, when it named one. Threaded here because this is the only
  // place that holds both the resolved `ModelSelection` and the router options.
  const modelBaseUrl = options.model?.url;
  const chain = resolveProviderChain({
    primary,
    ...(modelBaseUrl !== undefined ? { baseUrl: modelBaseUrl } : {}),
    ...(fallback !== undefined ? { fallback } : {}),
    ...(apiKeys !== undefined ? { apiKeys } : {}),
    ...(credentialPoolStrategy !== undefined ? { credentialPoolStrategy } : {}),
    ...(extractToolCallsFromContent === true ? { extractToolCallsFromContent: true } : {}),
    ...(rateLimitSink !== undefined
      ? {
          onRateLimit: (info: { attempt: number; retryAfterMs?: number }) =>
            emitRunEvent(rateLimitSink, { type: "rate_limit", ...info }),
        }
      : {}),
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
    ...(userImages !== undefined ? { userImages } : {}),
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
    ...(options.sendOptions.activeTools !== undefined
      ? { activeTools: options.sendOptions.activeTools }
      : {}),
    // SE1 — resolve the run's permission mode: per-send wins over creation-time.
    ...((options.sendOptions.permissionMode ?? options.agentOptions.permissionMode) !== undefined
      ? {
          permissionMode: options.sendOptions.permissionMode ?? options.agentOptions.permissionMode,
        }
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
      options.subagents,
      options.model,
    ),
    ...(options.pluginManager !== undefined ? { pluginManager: options.pluginManager } : {}),
    // D318 — forward SendOptions.signal to the agent loop so streamLlmTurn
    // can attach it to the LLM `fetch({ signal })` call.
    ...(options.sendOptions.signal !== undefined ? { signal: options.sendOptions.signal } : {}),
    // M7 — forward SendOptions.context to the loop so every tool handler receives
    // it on `ctx.context` (shared run config set once, e.g. projectRoot).
    ...(options.sendOptions.context !== undefined ? { context: options.sendOptions.context } : {}),
    // SE2 — forward the opt-in typed runtime-event sink to the loop.
    ...(options.sendOptions.onRunEvent !== undefined
      ? { runEventSink: options.sendOptions.onRunEvent }
      : {}),
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

/**
 * M77 — the process-wide pool backing `mcpLifecycle: 'session'`.
 *
 * Keyed by `(agentId, server, config)`, so it is session-scoped despite being a module-level object:
 * `agentId` IS the session identity here (it is what `getSessionMessages` keys the transcript cache
 * by), and `LocalAgent.dispose()` releases its own entries. Two agents never see each other's
 * clients.
 */
const sessionMcpPool = new McpClientPool<McpClient>();

/** M77 — release one session's pooled MCP clients. Called from `LocalAgent.dispose()`. */
export function disposeSessionMcpClients(agentId: string): void {
  sessionMcpPool.disposeSession(agentId, (client) => {
    void client.close();
  });
}

/**
 * M77 — the production seam, exported for the wiring test.
 *
 * Exported (`_` prefix, `@internal`) rather than left private because the pool is only worth having
 * if `buildMcpMap` actually reaches it. Testing the pool class alone would prove the CLASS reuses,
 * not that the SYSTEM does — the exact gap the M76 review found in the ask-bridge.
 *
 * @internal
 */
export function _buildMcpMapForTests(options: CreateRealLocalRunOptions): Map<string, McpClient> {
  return buildMcpMap(options);
}

/**
 * theokit#155 — does THIS RUN own the MCP clients it was handed?
 *
 * Under the default `'run'` lifecycle the client is built for this send and dies with it, so the
 * run closes it. Under `'session'` the pool owns it: closing it at the end of the turn SIGTERMs the
 * child process, and the next turn spawns a new one — which is exactly why the option measured
 * 0 ms of savings. Ownership is derived here, once, so `buildMcpMap` and the run's `finally` cannot
 * disagree about who releases the resource.
 */
function runOwnsMcpClients(agentOptions: AgentOptions): boolean {
  return agentOptions.mcpLifecycle !== "session";
}

function buildMcpMap(options: CreateRealLocalRunOptions): Map<string, McpClient> {
  const map = new Map<string, McpClient>();
  const inline = options.sendOptions.mcpServers ?? options.agentOptions.mcpServers;
  if (inline === undefined) return map;

  // M77 — `'run'` stays the default: a client per send, dropped with the run. Only an explicit
  // `mcpLifecycle: 'session'` reaches the pool, because pooling changes the failure model (see the
  // option's docblock). The reap runs on acquisition rather than on a timer: a timer would keep the
  // process alive, and a pool nobody touches has nothing worth reaping.
  const pooled = !runOwnsMcpClients(options.agentOptions);
  if (pooled) sessionMcpPool.reapIdle((c) => void c.close());

  for (const [name, config] of Object.entries(inline)) {
    map.set(
      name,
      pooled
        ? sessionMcpPool.acquire(options.agentId, name, config, () => createMcpClient(name, config))
        : createMcpClient(name, config),
    );
  }
  return map;
}

class RealLocalRun extends FixtureRunBase {
  private readonly buildInputs: () => AgentLoopInputs;
  /** theokit#155 — whether this turn releases its MCP clients, or the session pool does. */
  private readonly ownsMcpClients: boolean;
  /** theokit#148 — what a delegated child inherits from this parent, scoped to the loop. */
  private readonly inheritedCredentials: InheritedCredentials;

  constructor(
    options: ConstructorParameters<typeof FixtureRunBase>[0],
    buildInputs: () => AgentLoopInputs,
    ownsMcpClients: boolean,
    inheritedCredentials: InheritedCredentials,
  ) {
    super(options);
    this.buildInputs = buildInputs;
    this.ownsMcpClients = ownsMcpClients;
    this.inheritedCredentials = inheritedCredentials;
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

  /**
   * theokit#140 - events already handed to stream() by the live subscriber.
   *
   * The loop still RETURNS its full event list, and that batch path is deliberately kept: it is the
   * fallback if a live event is ever lost, and removing it would make the live channel a single
   * point of failure for the whole transcript.
   */
  private readonly liveDelivered = new Set<SDKMessage>();

  private async executeAgentLoop(inputs: AgentLoopInputs): Promise<void> {
    // theokit#140 - subscribe BEFORE the loop runs, so nothing is missed between start and the
    // first await. Events now reach stream() in true order as they happen, instead of arriving as
    // one post-completion batch while onDelta streamed tokens on a separate clock.
    // theokit#140 - whether a text delta has crossed since the last assistant message was reported.
    // This is the FACT that lets the timeline say `textAlreadyStreamed` instead of leaving the
    // consumer to infer it by comparing text - the inference that produced the `callId`-namespace
    // and timestamp-fallback bugs. Scoped per run, reset at each assistant message so a multi-step
    // run answers the question per message rather than once for the whole run.
    let textStreamedSinceLastMessage = false;
    inputs.onLoopEvent = (event: SDKMessage) => {
      this.liveDelivered.add(event);
      this.script.events.push(event);
      // theokit#140 - the same event on the complete timeline. Both views are fed from the one
      // place the loop reports, so they cannot disagree about order or contents.
      const carriesText =
        event.type === "assistant" && event.message.content.some((b) => b.type === "text");
      this.pushTimeline(
        carriesText
          ? { kind: "message", message: event, textAlreadyStreamed: textStreamedSinceLastMessage }
          : // No text ⇒ the question does not apply. Marking a tool-only or structural message
            // would be a claim the consumer acts on by HIDING content it was never shown.
            { kind: "message", message: event },
      );
      if (carriesText) textStreamedSinceLastMessage = false;
      this.notifyNewEvents();
    };
    // theokit#140 - the OTHER half of the timeline. Deltas were only ever reachable through the
    // caller's own `onDelta`, which is why a consumer had to fuse two surfaces to see tokens and
    // tool calls in one order. The caller's callback is preserved and still fires first: this wraps
    // it, never replaces it.
    const callerOnDelta = inputs.onDelta;
    inputs.onDelta = (delta) => {
      callerOnDelta?.(delta);
      if (delta.update.type === "text-delta") textStreamedSinceLastMessage = true;
      this.pushTimeline({ kind: "delta", update: delta.update });
    };
    try {
      // SE18 — when the send set `activeTools`, run the loop inside a tool-whitelist
      // scope so a call to a tool outside the set is vetoed at dispatch (same path as
      // `Agent.fork`'s `allowedTools`). Absent ⇒ the full toolset is available.
      const runLoop = (): Promise<Awaited<ReturnType<typeof runAgentLoop>>> =>
        inputs.activeTools !== undefined
          ? withToolWhitelist(new Set(inputs.activeTools), () => runAgentLoop(inputs))
          : runAgentLoop(inputs);
      // theokit#148 — publish the parent's delegation credentials for the duration of the loop.
      // A subagent tool reads them at dispatch, so they survive every layer that rebuilds the tool
      // object (including the SDK's own rebuild in `real-local-run-tools.ts`), and two concurrent
      // runs sharing one tool instance each see their own.
      const output = await withInheritedSubAgentCredentials(this.inheritedCredentials, runLoop);
      this.applyAgentLoopOutput(output);
      this.transitionTo(output.finalStatus);
    } catch (cause) {
      this.emitErrorEvent(cause, "Agent loop failed", "", "agent_loop_failed");
      this.transitionTo("error" satisfies RunStatus);
    } finally {
      // theokit#155 — release only what this TURN owns. Under `mcpLifecycle: 'session'` the pool
      // owns the client and releases it via `disposeSessionMcpClients` (`LocalAgent.dispose()`) plus
      // `reapIdle` on the next acquire; closing it here would kill the child the next turn expects
      // to still be running.
      if (this.ownsMcpClients) {
        for (const client of inputs.mcp.values()) {
          await client.close().catch(() => undefined);
        }
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
    this.deliverUndeliveredEvents(output.events);
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

  /**
   * theokit#140 - deliver only what the live subscriber has NOT already handed to `stream()`.
   *
   * The loop now reports each event as it happens, so this batch is the SAME list, replayed.
   * Without the guard every event would reach `stream()` twice: once live, once here.
   *
   * Identity, not deep equality: these are the very objects the live sink saw, and two genuinely
   * distinct events can be structurally identical (the same tool called twice with the same args
   * is not a duplicate).
   *
   * Extracted because the guard pushed `applyAgentLoopOutput` past the cognitive-complexity cap.
   */
  private deliverUndeliveredEvents(events: readonly SDKMessage[]): void {
    for (const event of events) {
      if (this.liveDelivered.has(event)) continue;
      this.script.events.push(event);
      this.notifyNewEvents();
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
