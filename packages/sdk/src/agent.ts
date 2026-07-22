import { AgentBuilder } from "./agent-builder.js";
import {
  getRegisteredAgentOrThrow,
  rehydrateExistingAgent,
  resolveAgentPersistenceCwd,
  runCreateUnderSpan,
  setAgentName,
  setArchivedFlag,
  toAgentInfo,
} from "./agent-helpers.js";
import {
  AgentRunError,
  ConfigurationError,
  coerceToKnownAgentRunErrorCode,
  UnknownAgentError,
} from "./errors.js";
import { enabledPluginNames } from "./internal/plugins/enabled-names.js";
import { discoverProviderPlugins } from "./internal/providers/discovery.js";
import { setAgentFacade } from "./internal/runtime/registry/agent-factory-registry.js";
import {
  flushRegistrySaves,
  getRegisteredAgent,
  hydrateRegistryFromDisk,
  listRegisteredAgents,
  removeRegisteredAgent,
} from "./internal/runtime/registry/agent-registry.js";
import {
  type LiveAgentRegistry,
  liveAgentRegistry,
} from "./internal/runtime/registry/live-agent-registry.js";
import {
  getRun as getRegisteredRun,
  listRunsByAgent,
} from "./internal/runtime/registry/run-registry.js";
import { SPAN_NAMES } from "./internal/telemetry/span-names.js";
import { createTelemetry, type OTelSpan } from "./internal/telemetry/tracer.js";
import type {
  AgentOperationOptions,
  AgentOptions,
  GetAgentOptions,
  GetRunOptions,
  ListAgentsOptions,
  ListResult,
  ListRunsOptions,
  SDKAgent,
  SDKAgentInfo,
} from "./types/agent.js";
import type { Run, RunResult } from "./types/run.js";

// T1.8 — memoized dynamic import for streamObject so the second+ call
// skips the promise resolution chain entirely. Module-level so it
// survives across Agent.streamObject invocations.
let streamObjectImport: Promise<typeof import("./stream-object.js")> | undefined;

/**
 * Result of a one-shot {@link Agent.prompt} call.
 *
 * @public
 */
export type AgentPromptResult = RunResult;

/**
 * Static façade for creating and managing Theo agents.
 *
 * @public
 */
export class Agent {
  private constructor() {
    // Static-only façade.
  }

  /**
   * Live-agent cache for production deploys (Production-Readiness #2, ADRs D307-D310).
   *
   * Caches `SDKAgent` instances by id with LRU eviction (when `size > maxAgents`)
   * and an idle-timeout sweep. Solves the OOM failure mode for long-running
   * Node servers spawning fresh agents per conversation.
   *
   * Defaults: `maxAgents: 100`, `idleTimeoutMs: 30 min`, sweep `60s`.
   * Configure for high-traffic SaaS:
   *
   * ```ts
   * Agent.registry.configure({ maxAgents: 1000, idleTimeoutMs: 15 * 60_000 });
   * process.on("SIGTERM", () => Agent.registry.evictAll());
   * ```
   *
   * Cache hits are automatic in `Agent.getOrCreate` (T2.6). Disable the cache
   * entirely via `configure({ maxAgents: 0 })` — every getOrCreate then
   * re-initializes.
   *
   * @public
   */
  static readonly registry: LiveAgentRegistry = liveAgentRegistry;

  /**
   * Create a new agent. Pass either `local` or `cloud` to pick a runtime.
   *
   * @public
   */
  static async create(options: AgentOptions): Promise<SDKAgent> {
    // T0.1: emit `agent.create` span around the FULL factory body so validation
    // throws and quota-gate rejections are recorded with ERROR status before
    // propagating to the caller.
    const telemetry = createTelemetry(options.telemetry);
    const runtime: "local" | "cloud" = options.cloud !== undefined ? "cloud" : "local";
    const span: OTelSpan = telemetry.startSpan(SPAN_NAMES.AGENT_CREATE, {
      runtime,
      pluginCount: enabledPluginNames(options.plugins).length,
    });
    try {
      // M47 wiring — provider-plugin discovery runs upfront (the `resolveProviderChain`
      // contract). Idempotent per process; fail-tolerant by design (never throws).
      await discoverProviderPlugins();
      const agent = await runCreateUnderSpan(options, span);
      return agent;
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: 2, message: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      span.end();
    }
  }

  /**
   * One-shot prompt: create an agent, send a single message, wait, dispose.
   *
   * When `options.throwOnError === true`, rejects with `AgentRunError` if
   * the run terminates with `status: 'error'` (instead of resolving with the
   * error wrapped in the RunResult). Cancelled runs still resolve normally.
   *
   * @public
   */
  static async prompt(message: string, options: AgentOptions): Promise<AgentPromptResult> {
    const agent = await Agent.create(options);
    try {
      const run = await agent.send(message);
      const result = await run.wait();
      if (
        options.throwOnError === true &&
        result.status === "error" &&
        result.error !== undefined
      ) {
        throw new AgentRunError(result.error.message, {
          code: coerceToKnownAgentRunErrorCode(result.error.code),
          cause: result.error.cause,
        });
      }
      return result;
    } finally {
      // T1.9 — dispose error MUST NOT mask the original error from
      // the try block. A failing dispose is cleanup, not business
      // logic — swallow silently so the consumer always sees the
      // real error (or the real result) from agent.send().
      try {
        await agent.dispose();
      } catch {
        // Swallowed — dispose cleanup must not propagate.
      }
    }
  }

  /**
   * Reattach to an existing agent by ID.
   *
   * @public
   */
  static async resume(agentId: string, options: Partial<AgentOptions> = {}): Promise<SDKAgent> {
    let existing = getRegisteredAgent(agentId);
    if (existing === undefined) {
      // D21: fall back to the persisted registry. Different cwds get isolated
      // registry.json files; we read the cwd the caller is operating in.
      const persistenceCwd = resolveAgentPersistenceCwd(options);
      await hydrateRegistryFromDisk(persistenceCwd);
      existing = getRegisteredAgent(agentId);
    }
    if (existing !== undefined) {
      return await rehydrateExistingAgent(agentId, existing, options);
    }
    // Cold miss: throw UnknownAgentError so chat-assistant bots can
    // explicitly branch to `Agent.create({ agentId, ...full options })` on
    // first contact. The previous silent cold-create with the caller's
    // partial options was a footgun — it persisted incomplete agents
    // (no model, no system prompt) that then failed at first send.
    //
    // Migration: callers that want the OLD "always succeed" behaviour
    // should catch `UnknownAgentError` and call `Agent.create` themselves.
    throw new UnknownAgentError(
      `Agent "${agentId}" not found. Use Agent.create({ agentId, ... }) for first-time setup, or catch UnknownAgentError to branch resume-vs-create.`,
      { code: "unknown_agent" },
    );
  }

  /**
   * Start building an {@link AgentOptions} via fluent chain. See ADR D25.
   * Terminals: `.build()`, `.create()`, `.getOrCreate(id)`.
   *
   * The builder receives `create` + `getOrCreate` as injected callbacks so
   * that `agent-builder.ts` doesn't need a static import of `Agent` — keeps
   * the module graph acyclic (G6).
   *
   * @public
   */
  static builder(): AgentBuilder {
    return new AgentBuilder({
      create: (options) => Agent.create(options),
      getOrCreate: (agentId, options) => Agent.getOrCreate(agentId, options),
    });
  }

  /**
   * Generate a typed object matching a Zod schema via a synthetic forced
   * tool call (ADR D33). One-shot: create transient agent → send prompt →
   * model calls `output` tool → parse args via Zod → return typed.
   *
   * @public
   */
  static async generateObject<T extends import("zod").ZodType>(
    options: import("./generate-object.js").GenerateObjectOptions<T>,
  ): Promise<import("./generate-object.js").GenerateObjectResult<import("zod").z.infer<T>>> {
    const { generateObjectImpl } = await import("./generate-object.js");
    return generateObjectImpl(options, {
      create: (opts) => Agent.create(opts),
      delete: (agentId) => Agent.delete(agentId),
    });
  }

  /**
   * Stream a structured output object alongside intermediate `partial`
   * deltas as the model accumulates its response (ADR D39). Returns an
   * `AsyncIterator<StreamObjectEvent<T>>` that yields zero or more
   * `partial` events and exactly one `complete` event at the end.
   *
   * The `complete` event carries the same `object: z.infer<T>` you would get
   * from `Agent.generateObject` — same prompt + schema + model produces
   * the same final object.
   *
   * @public
   */
  static streamObject<T extends import("zod").ZodType>(
    options: import("./stream-object.js").StreamObjectOptions<T>,
  ): AsyncGenerator<
    import("./stream-object.js").StreamObjectEvent<import("zod").z.infer<T>>,
    void,
    void
  > {
    // T1.8 — Lazy-import the implementation; memoized so the second+
    // call skips the promise chain entirely. Consumers that never call
    // streamObject don't pay the import cost at all.
    const deps = {
      create: (opts: import("./types/agent.js").AgentOptions) => Agent.create(opts),
      delete: (agentId: string) => Agent.delete(agentId),
    };
    async function* wrapper() {
      // T1.8 — memoized dynamic import: first call resolves the module;
      // subsequent calls reuse the cached promise (no re-await overhead).
      streamObjectImport ??= import("./stream-object.js");
      const { streamObjectImpl } = await streamObjectImport;
      yield* streamObjectImpl(options, deps);
    }
    return wrapper();
  }

  /**
   * Run N prompts in parallel with bounded concurrency (ADRs D134-D140).
   *
   * Each prompt gets a fresh agent (create → send → wait → dispose). Failures
   * are isolated per-prompt; the batch never throws on a single failure —
   * inspect `result.ok` to discriminate success vs error. Default
   * concurrency is 4. When `options.providers.apiKeys` has ≥2 keys per
   * provider, all in-flight agents share a single credential pool via
   * `AsyncLocalStorage` (EC-A) so rate-limit cooldowns are observed once
   * instead of duplicated per agent.
   *
   * Streaming progress is opt-in via `onResult` / `onProgress`. `AbortSignal`
   * cancels pending prompts; in-flight ones continue to completion (Node
   * AbortSignal semantics). `signal.reason` propagates to `error` when set.
   *
   * @public
   */
  static async batch(
    prompts: ReadonlyArray<string | import("./types/batch.js").BatchItem>,
    options: import("./types/batch.js").BatchOptions,
  ): Promise<import("./types/batch.js").BatchResult[]> {
    const { batchImpl } = await import("./batch.js");
    return batchImpl(prompts, options, { create: (opts) => Agent.create(opts) });
  }

  /**
   * Get an existing agent by ID, or create one with the supplied options if
   * the ID is not yet registered. Eliminates the resume-vs-create boilerplate
   * common to chat bots and other long-running agent consumers. See ADR D22.
   *
   * Resolution:
   * 1. Try `Agent.resume(agentId, options)`. Return on success.
   * 2. On `UnknownAgentError`, fall through to `Agent.create({ ...options, agentId })`.
   * 3. On same-process race (`ConfigurationError(code: "agent_id_already_exists")`
   *    during step 2), retry `Agent.resume` once and return the winner's handle.
   * 4. Any other error propagates verbatim.
   *
   * Caveats:
   * - The function-level `agentId` always wins over `options.agentId`.
   * - Options differ between calls? Last-call-wins for this handle (matches `Agent.resume`).
   * - Disposed agents are NOT auto-deleted from the registry. To force a fresh
   *   agent, call `Agent.delete(agentId)` first.
   *
   * @public
   */
  static async getOrCreate(agentId: string, options: AgentOptions): Promise<SDKAgent> {
    // T2.6: live-agent cache hit. `get` refreshes lastUsedAt so the entry
    // resists LRU eviction. Cache disabled via `Agent.registry.configure({ maxAgents: 0 })`
    // — set is no-op, get always returns undefined, so re-initialization runs.
    const cached = Agent.registry.get(agentId);
    if (cached !== undefined) return cached;

    const fresh = await getOrCreateUncached(agentId, options);
    Agent.registry.set(agentId, fresh);
    return fresh;
  }

  /**
   * List agents (local or cloud).
   *
   * @public
   */
  static async list(options: ListAgentsOptions = {}): Promise<ListResult<SDKAgentInfo>> {
    await hydrateRegistryFromDisk(process.cwd());
    const runtime = options.runtime;
    const all = listRegisteredAgents(runtime);
    const items = all.map((agent) => toAgentInfo(agent));
    return { items };
  }

  /**
   * Get metadata for a single agent.
   *
   * @public
   */
  static async get(agentId: string, _options: GetAgentOptions = {}): Promise<SDKAgentInfo> {
    const agent = await getRegisteredAgentOrThrow(agentId);
    return toAgentInfo(agent);
  }

  /**
   * List runs for an agent.
   *
   * @public
   */
  static async listRuns(agentId: string, _options: ListRunsOptions = {}): Promise<ListResult<Run>> {
    await getRegisteredAgentOrThrow(agentId);
    return { items: listRunsByAgent(agentId) };
  }

  /**
   * Get a single run.
   *
   * @public
   */
  static async getRun(runId: string, options: GetRunOptions = {}): Promise<Run> {
    if (options.runtime === "cloud") {
      throw new ConfigurationError(
        "Cloud runtime is pre-release. Theo PaaS endpoints are not wired yet — getRun({ runtime: 'cloud' }) will be enabled when the PaaS ships.",
        { code: "cloud_runtime_pre_release" },
      );
    }
    const existing = getRegisteredRun(runId);
    if (existing !== undefined) return existing;
    throw new UnknownAgentError(
      `Run ${runId} is not in this process's registry. It may have been disposed, persisted in a previous process, or never created.`,
      { code: "run_not_found" },
    );
  }

  /**
   * Archive a cloud agent.
   *
   * @public
   */
  static archive(agentId: string, _options: AgentOperationOptions = {}): Promise<void> {
    return setArchivedFlag(agentId, true);
  }

  /**
   * Restore an archived cloud agent.
   *
   * @public
   */
  static unarchive(agentId: string, _options: AgentOperationOptions = {}): Promise<void> {
    return setArchivedFlag(agentId, false);
  }

  /**
   * Set the human-facing `name` of a registered agent (the label `Agent.list()` returns). The registry
   * already carries a `name` field; this is the missing public mutator for it. Runtime-agnostic (mutates
   * the local per-cwd registry for local agents; the cloud registry for cloud agents).
   *
   * @public
   */
  static async rename(
    agentId: string,
    name: string,
    _options: AgentOperationOptions = {},
  ): Promise<void> {
    await setAgentName(agentId, name);
  }

  /**
   * Permanently delete a cloud agent.
   *
   * @public
   */
  static async delete(agentId: string, _options: AgentOperationOptions = {}): Promise<void> {
    removeRegisteredAgent(agentId);
    await flushRegistrySaves();
  }
}

async function getOrCreateUncached(agentId: string, options: AgentOptions): Promise<SDKAgent> {
  try {
    return await Agent.resume(agentId, options);
  } catch (err) {
    if (!(err instanceof UnknownAgentError)) throw err;
  }
  try {
    return await Agent.create({ ...options, agentId });
  } catch (err) {
    if (err instanceof ConfigurationError && err.code === "agent_id_already_exists") {
      return await Agent.resume(agentId, options);
    }
    throw err;
  }
}

// Module-init registration so internal subsystems (LocalAgent.runUntil /
// LocalAgent.fork, eval, scorers, cron) can invoke the public facade without
// inverting the public-api -> internal dependency direction. See
// `internal/runtime/registry/agent-factory-registry.ts` for rationale.
setAgentFacade({
  create: (options) => Agent.create(options),
  delete: (agentId) => Agent.delete(agentId),
  prompt: (message, options) => Agent.prompt(message, options),
  get: (agentId) => Agent.get(agentId),
  resume: (agentId, options) => Agent.resume(agentId, options),
  batch: (prompts, options) => Agent.batch(prompts, options),
});
