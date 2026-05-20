import type { SystemPromptContext } from "../../../types/agent.js";
import type { MemoryFact } from "../memory-store.js";

/**
 * Context passed to every {@link SystemPromptProvider}. Extends the public
 * {@link SystemPromptContext} with internal fields populated by the agent
 * harness — context snapshot per-source content, memory facts, the
 * user-resolved base prompt, and per-block opt-out flags.
 *
 * @internal
 */
export interface SystemPromptAssemblyContext extends SystemPromptContext {
  /** Per-source raw token slices from the context manager. */
  contextSnapshot?: ContextSnapshotForAssembly;
  /** Hard cap on tokens devoted to the context block. */
  contextMaxTokens?: number;
  /** Whether the skills auto-injection block is enabled. */
  skillsAutoInject?: boolean;
  /** Recalled memory facts; appended-only field per ADR D5. */
  memory: ReadonlyArray<MemoryFact>;
  /** Whether the memory auto-injection block is enabled. */
  memoryAutoInject?: boolean;
  /** The user-resolved base system prompt (string or resolver output). */
  baseSystemPrompt?: string;
  /** Active Memory recall summary (Phase 7 of memory-system-openclaw-parity). */
  activeMemorySummary?: string;
}

/**
 * Per-source view used by `ContextPromptProvider`. Mirrors the
 * `FileContextManager` internal shape — included sources expose their token
 * slice so the provider can format the `<source>` body honouring the budget.
 *
 * @internal
 */
export interface ContextSnapshotForAssembly {
  sources: ReadonlyArray<ContextSourceForAssembly>;
}

export interface ContextSourceForAssembly {
  name: string;
  status: "included" | "excluded" | "summarized";
  tokens: ReadonlyArray<string>;
}

/**
 * One contributor in the system-prompt pipeline. Each provider owns a single
 * block — `<context>`, `<skills>`, `<memory>`, or the user's base prompt.
 * New blocks (plugins, environment, time) are added by writing a new class
 * that implements this interface and registering it in
 * `SystemPromptPipeline.default()`.
 *
 * @internal
 */
export interface SystemPromptProvider {
  /** Stable identifier used in diagnostics and for deterministic tiebreak. */
  readonly id: string;
  /** Sort key. Lower priorities contribute earlier. */
  readonly priority: number;
  /** Returns the formatted block, `undefined` when this provider has nothing. */
  contribute(ctx: SystemPromptAssemblyContext): Promise<string | undefined>;
}
