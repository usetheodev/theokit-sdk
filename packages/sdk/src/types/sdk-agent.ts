import type { ModelSelection } from "./agent-prims.js";
import type { SDKContextManager } from "./context.js";
import type { SDKProvidersManager } from "./providers.js";
import type { Run, SDKUserMessage, SendOptions } from "./run.js";

/**
 * Public skill metadata exposed to the system-prompt resolver. Mirrors the
 * shape returned by `agent.skills.list()` — name + description only, never
 * full skill bodies.
 *
 * @public
 */
export interface SystemPromptSkillRef {
  name: string;
  description: string;
}

/**
 * A skill resolved WITH its body, returned by {@link SDKAgentSkills.get}. Unlike
 * {@link SystemPromptSkillRef} (name + description only), this carries the full
 * `instructions` — read from the SKILL.md for filesystem skills or the inline
 * `createSkill` body. @public
 */
export interface SDKAgentSkillDetail {
  name: string;
  description: string;
  instructions: string;
  /** SE21 — supporting documents bundled with the skill (filename → content), when present. */
  references?: Record<string, string>;
}

/**
 * The skill handle exposed as `agent.skills`, present only when project-scoped skills are enabled
 * (`settingSources: ["project"]`) or `skills.enabled` is set. The property is optional on the agent,
 * and `undefined` there means skills were never turned on — not that none were found.
 *
 * The split between its two methods is the choice it asks of a caller. `list()` returns name and
 * description only, which is what belongs in a system prompt: it stays cheap and it keeps skill
 * bodies out of the context window. `get(name)` resolves one skill WITH its `instructions` — the
 * SKILL.md body for a filesystem skill, the inline body for one built with `createSkill` — and
 * returns `undefined` when no enabled skill matches that name. Ask for a body only when you are
 * about to use it.
 *
 * @public
 */
export interface SDKAgentSkills {
  list(): Promise<ReadonlyArray<SystemPromptSkillRef>>;
  /**
   * SE20 — resolve a skill by name INCLUDING its body (`instructions`). Returns
   * `undefined` when no enabled skill matches. `list()` stays lean (name +
   * description); full bodies come only through `get`.
   */
  get(name: string): Promise<SDKAgentSkillDetail | undefined>;
}

/**
 * Public plugin metadata returned by `agent.plugins.list()`. Mirrors the
 * `.theokit/plugins/<name>/MANIFEST.json` allow-listed shape; never exposes
 * raw plugin bodies, credentials, or internal hooks.
 *
 * @public
 */
export interface SDKPluginMetadata {
  name: string;
  description?: string;
}

/**
 * Public plugin listing handle exposed as `agent.plugins`. Populated when
 * `settingSources` includes `"plugins"` OR when `plugins.enabled` is set
 * on the agent options.
 *
 * @public
 */
export interface SDKAgentPlugins {
  list(): Promise<ReadonlyArray<SDKPluginMetadata>>;
}

/**
 * Artifact produced inside an agent's workspace. Cloud-only.
 *
 * @public
 */
export interface SDKArtifact {
  path: string;
  sizeBytes: number;
  updatedAt: string;
}

/**
 * Handle returned by `Agent.create()` and `Agent.resume()`.
 *
 * @public
 */
export interface SDKAgent {
  readonly agentId: string;
  readonly model: ModelSelection | undefined;
  /**
   * Context manager for this agent. Populated when context is enabled via
   * {@link AgentOptions.context}. See {@link SDKContextManager}.
   */
  readonly context?: SDKContextManager;
  /**
   * Provider routing inspector for this agent. Populated when at least one
   * provider route is configured (via {@link AgentOptions.providers}, plugins,
   * or model-implied providers). See {@link SDKProvidersManager}.
   */
  readonly providers?: SDKProvidersManager;
  /**
   * Skill listing for this agent. Populated when project-scoped skills are
   * enabled (`settingSources: ["project"]`) or when `skills.enabled` is set.
   * See {@link SDKAgentSkills}.
   */
  readonly skills?: SDKAgentSkills;
  /**
   * Plugin listing for this agent. Populated when project-scoped plugins are
   * enabled (`settingSources: ["plugins"]`) or when `plugins.enabled` is set.
   * See {@link SDKAgentPlugins}.
   */
  readonly plugins?: SDKAgentPlugins;
  send(message: string | SDKUserMessage, options?: SendOptions): Promise<Run>;
  /**
   * SE9 — integrated structured output. Runs the normal tool loop (the tools run
   * first) then coerces the final answer into the `output` Zod schema, returning a
   * validated, inferred-typed object. Sugar over `Agent.generateObject` (ADR D33).
   */
  generate<T extends import("zod").ZodType>(
    message: string | SDKUserMessage,
    options: import("./run.js").GenerateOptions<T>,
  ): Promise<import("./run.js").GenerateRunResult<import("zod").z.infer<T>>>;
  /** Fire-and-forget disposal. */
  close(): void;
  /** Re-read filesystem config (context, hooks, project MCP, subagents) without disposing. */
  reload(): Promise<void>;
  /**
   * Async disposal. Idempotent — calling more than once is a no-op (per ADR D5).
   * Prefer `await using agent = await Agent.create(...)` over explicit
   * `dispose()` for resource safety.
   */
  dispose(): Promise<void>;
  /**
   * `await using` support per ADR D5. Identical semantics to `dispose()` —
   * idempotent across both surfaces.
   */
  [Symbol.asyncDispose](): Promise<void>;
  /** Cloud-only. Local returns an empty array. */
  listArtifacts(): Promise<SDKArtifact[]>;
  /** Cloud-only. Local throws `UnsupportedRunOperationError`. */
  downloadArtifact(path: string): Promise<Buffer>;
  /**
   * Signal that prompt cache should be invalidated. By default deferred —
   * applied at the start of the next `send()`. Pass `{ applyNow: true }` to
   * force immediate disposal (caller must `Agent.create()` again to use).
   *
   * Cache invalidation is a cost regression (provider charges full price
   * for the rebuilt cache; see ADRs D94-D95). Use sparingly and deliberately.
   *
   * Cloud agents: no-op (cloud runtime reconstructs state per request).
   *
   * @public
   */
  invalidateCache?(reason: string, options?: InvalidateCacheOptions): Promise<void>;
  /**
   * Goal-driven Ralph loop (ADRs D115-D121). Iterates `agent.send` →
   * judge → continuation until the auxiliary judge model returns `done`,
   * the judge fails too many times in a row, max turns are exhausted,
   * or the caller aborts via `AbortSignal`.
   *
   * Yields {@link import("./goal-events.js").GoalEvent} per state
   * transition; returns a {@link import("./goal-events.js").GoalResult}
   * summary as the generator's final value.
   *
   * Cloud agents throw {@link import("../errors.js").UnsupportedRunOperationError}
   * **synchronously** (no AsyncGenerator returned) — wrap in try/catch
   * if you support both runtimes.
   *
   * Caveat: do not call `agent.dispose()` mid-iteration; the next `send`
   * propagates the disposal error through the generator to the consumer.
   *
   * @public
   */
  runUntil?(
    goal?: string,
    options?: import("./goal-events.js").GoalOptions,
  ): import("./goal-events.js").RunUntilIterator;
  /**
   * Fork a short-lived sub-agent with parent's credentials + system
   * prompt byte-identical (ADR D112 — cache hit) and a restricted tool
   * whitelist (ADR D111 — AsyncLocalStorage isolation).
   *
   * Cloud agents throw {@link import("../errors.js").UnsupportedRunOperationError}.
   *
   * @public
   */
  fork?(options: import("./fork.js").ForkOptions): Promise<import("./fork.js").ForkResult>;
  /**
   * Drive `send` to completion across iteration-ceiling truncations (M1 Phase 3).
   * When a `send` stops at the loop's iteration cap (`RunResult.stoppedAtIterationLimit`),
   * this re-sends a short continuation prompt — the agent's stateful session
   * preserves the conversation — until a genuine terminal: `done` (finished),
   * `step_limit` (`maxRounds` exhausted), or `no_progress` (two empty rounds).
   *
   * Local agents only. Cloud agents throw
   * {@link import("../errors.js").UnsupportedRunOperationError} (the cloud
   * runtime manages its own continuation policy server-side).
   *
   * @public
   */
  runToCompletion?(
    message: string,
    options?: import("./run.js").RunToCompletionOptions,
  ): Promise<import("./run.js").RunToCompletionResult>;
  /**
   * STREAMING continuation driver (V3-4) — the streaming twin of
   * {@link SDKAgent.runToCompletion}. Returns an `AsyncGenerator` that yields each
   * round's {@link import("./messages.js").SDKMessage}s LIVE (for a UI), reusing the
   * same terminal policy (`done`/`step_limit`/`no_progress` + bounded re-prompt).
   *
   * The {@link import("./run.js").StreamToCompletionResult} is the generator's RETURN
   * value — read it via a manual `gen.next()` loop (`while (!res.done) res = await
   * gen.next()` → `res.value`); a plain `for await...of` consumes the yielded
   * messages but discards the return value.
   *
   * Local agents only. Cloud agents throw
   * {@link import("../errors.js").UnsupportedRunOperationError}.
   *
   * @public
   */
  streamToCompletion?(
    message: string,
    options?: import("./run.js").RunToCompletionOptions,
  ): AsyncGenerator<
    import("./messages.js").SDKMessage,
    import("./run.js").StreamToCompletionResult
  >;
  /**
   * Direct API to third-party memory adapter(s) registered via
   * `plugins: [...]` (ADR D141 / D142). Returns `null` when no adapter
   * is registered. In multi-adapter setups `write` fans out to all;
   * `recall` merges + dedupes; `delete` routes by `MemoryId` prefix.
   *
   * @public
   */
  memory?: import("./memory-adapter.js").AgentMemory;
  /**
   * Activate a personality preset for the next `send` (Hermes #26).
   * Reserved names `"none"`, `"default"`, and `"neutral"` clear the
   * active preset. Returns the resolved preset (or `null` when cleared).
   *
   * Persistence: pass `{ save: true }` to persist across process
   * restarts (stored under `$THEOKIT_HOME/personality.json`).
   *
   * History: by default the conversation history is preserved across
   * the switch. Pass `{ reset: true }` to also clear the session.
   *
   * Cloud agents throw {@link import("../errors.js").UnsupportedRunOperationError}.
   *
   * @public
   */
  usePersonality?(
    name: string,
    opts?: { save?: boolean; reset?: boolean },
  ): Promise<PersonalityPreset | null>;
}

/**
 * Resolved personality preset surfaced via {@link SDKAgent.usePersonality}
 * (Hermes #26, ADRs D160-D169). Re-declared here so the public DTS bundle
 * never crosses the `internal/` path boundary. The implementation type in
 * `internal/personality/types.ts` is structurally identical.
 *
 * @public
 */
export interface PersonalityPreset {
  readonly name: string;
  readonly description: string | undefined;
  readonly tools: ReadonlyArray<string> | undefined;
  readonly model: string | undefined;
  readonly tags: ReadonlyArray<string> | undefined;
  readonly systemPrompt: string;
  readonly source: "project" | "user";
  readonly sourcePath: string;
}

/**
 * Options for {@link SDKAgent.invalidateCache}.
 *
 * @public
 */
export interface InvalidateCacheOptions {
  /**
   * When `true`, dispose the agent immediately so caller must recreate it
   * to continue. Default `false` (deferred — applied on next `send()`).
   */
  applyNow?: boolean;
}
