import type { Run } from "../../../types/run.js";
import type { RunEventSink } from "../../../types/run-events.js";
import { emitRunEvent } from "../../../types/run-events.js";
import type { SessionStore } from "../../../types/session-store.js";
import type { LocalAgentMemory } from "../../local-agent/local-agent-memory.js";
import { writeSessionSummary } from "../../memory/storage/session-summary-writer.js";
import { getCatalogModelInfo } from "../../providers/catalog-loader.js";
import { buildDefaultSummarizer } from "../../session/compact-session.js";
import {
  appendSessionMessage,
  flushSessionWrites,
  persistTurnToTranscript,
} from "../../session/index.js";
import type { HooksExecutor } from "../hooks/hooks-executor.js";
import { shouldUsePortMemoryPath } from "../memory/memory-path-selector.js";
import type { MemoryProvider } from "../memory/memory-provider.js";

/**
 * Inputs for {@link runPostRunLifecycle}. Bundled into a single record so the
 * caller (LocalAgent.send) doesn't carry a long positional argument list.
 *
 * SE41 — the `sessionStore` persists the native records (FS default or an injected
 * external store); `model` is stamped into the assistant records.
 *
 * @internal
 */
export interface PostRunLifecycleInputs {
  run: Run;
  userText: string;
  agentId: string;
  workspaceCwd: string;
  /** SE41 — the session record store (FS default, or an injected external store). */
  sessionStore: SessionStore;
  /** SE40 — model id stamped into the assistant records. */
  model: string;
  /** M50 — provider key for the auto-compaction summarizer (absent ⇒ env-resolved by the router). */
  apiKey?: string;
  /** SE2 — surface a `compact_boundary` RunEvent when a persistence-side compaction fires. */
  onRunEvent?: RunEventSink;
  hooksExecutor: HooksExecutor;
  memoryGlue: LocalAgentMemory;
  /**
   * SDK 2.0 Phase 1 physical Stage 3 prep — iter 27 (refined iter 28):
   * optional port-based session-summary recorder. When supplied AND the
   * provider implements `recordSessionSummary`, the kernel delegates
   * the write through the port. When absent, falls back to the
   * legacy direct `writeSessionSummary` import (current behavior).
   *
   * STATELESS — no handle param needed (post-run-lifecycle runs AFTER
   * runAgentLoop disposes the per-run handle). `cwd` lives on the
   * args passed to the impl.
   */
  memoryProvider?: MemoryProvider;
}

/**
 * Post-run side effects executed inside the per-agent send mutex (ADR D19):
 *
 *  1. Persist the assistant turn to the per-agent JSONL (ADR D18).
 *  2. On status=finished, write a session-summary markdown for the
 *     `corpus="sessions"` memory_search index (ADR D20).
 *  3. Fire the `postRun` hook with the resolved status.
 *  4. Flush pending session writes so dispose() never races the writer.
 *
 * Errors are swallowed at the call site so `agent.send()` callers observe
 * failures through their own `run.wait()` / `stream()` surfaces. Mutex release
 * is guaranteed via the final `flushSessionWrites` even on the cancelled path.
 *
 * Extracted from LocalAgent to keep that class under the G8 LoC budget.
 *
 * @internal
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: lifecycle orchestrator dispatches across multiple subsystems
export async function runPostRunLifecycle(inputs: PostRunLifecycleInputs): Promise<void> {
  const {
    run,
    userText,
    agentId,
    workspaceCwd,
    sessionStore,
    model,
    onRunEvent,
    hooksExecutor,
    memoryGlue,
    memoryProvider,
  } = inputs;
  let result: Awaited<ReturnType<Run["wait"]>>;
  try {
    result = await run.wait();
  } catch {
    // Caller observes failures via their own run.wait()/stream(); the
    // mutex still releases via the flushes below.
    await flushSessionWrites();
    return;
  }

  if (result.result !== undefined) {
    // In-memory cache: seed `priorMessages` for the NEXT send.
    appendSessionMessage(agentId, { role: "assistant", text: result.result });
  }

  // SE40 — persist the WHOLE turn (user + assistant + tool blocks) to the native
  // Claude-shaped transcript, once per send, from the rich `run.conversation()` view.
  // SE41 — through the session store (FS default or injected external store).
  const conversation = await safeConversation(run);
  // M50 — size-driven auto-compaction rides the SAME persistence chain: real usage from the run's
  // Completed (Codex `last_token_usage.total_tokens` analog) vs the model's catalog context window.
  // Missing usage/window ⇒ the trigger never fires (fail-safe); the summarizer is the compression
  // subsystem's aux-LLM via `buildDefaultSummarizer`.
  const contextWindow = getCatalogModelInfo(model)?.limit?.context;
  // M50 review F2 — a model absent from the catalog silently disables the auto-trigger; the plan
  // promised a once-per-process WARN so the silence is at least visible.
  if (contextWindow === undefined) {
    const g = globalThis as unknown as Record<symbol, Set<string>>;
    const sym = Symbol.for("theokit-sdk.compact.no-cw-warned");
    const warned = (g[sym] ??= new Set<string>());
    if (!warned.has(model)) {
      warned.add(model);
      process.stderr.write(
        `[theokit-sdk] auto-compaction disabled: model "${model}" has no context-window entry in the catalog\n`,
      );
    }
  }
  // M50 review F3 — Codex uses the LAST response's usage as the active-context proxy; the aggregate
  // sums every round (each re-sends the whole context) and fires the trigger prematurely on
  // multi-round agentic turns. Prefer the last request's breakdown when available.
  const lastRequestUsage = result.usage?.requests?.at(-1)?.totalTokens;
  const usageForTrigger = lastRequestUsage ?? result.usage?.totalTokens;
  persistTurnToTranscript(
    sessionStore,
    { cwd: workspaceCwd, agentId, model },
    agentId,
    {
      userText,
      conversation,
      autoCompact: {
        usageTotal: usageForTrigger,
        contextWindow,
        summarize: buildDefaultSummarizer({
          agentModel: model,
          ...(inputs.apiKey !== undefined ? { apiKey: inputs.apiKey } : {}),
        }),
      },
    },
    onRunEvent !== undefined
      ? () => emitRunEvent(onRunEvent, { type: "compact_boundary", trigger: "auto" })
      : undefined,
  );

  // ADR D20 + EC-9: only finished runs feed the corpus="sessions" index.
  if (result.status === "finished" && result.result !== undefined) {
    const summaryArgs = {
      cwd: workspaceCwd,
      runId: result.id,
      agentId,
      userText,
      assistantText: result.result,
      status: "finished" as const,
      at: Date.now(),
    };
    try {
      // SDK 2.0 Phase 1 physical Stage 3 prep — iter 27 (refined iter 28):
      // prefer the STATELESS port-based `provider.recordSessionSummary`
      // when defined. Falls back to the direct `writeSessionSummary`
      // import otherwise (legacy behavior). Both paths handle the
      // markdown write + disk persistence; the difference is WHERE the
      // impl lives. Stateless = no handle needed (post-run-lifecycle
      // runs AFTER runAgentLoop disposed the per-run handle).
      if (memoryProvider?.recordSessionSummary !== undefined) {
        await memoryProvider.recordSessionSummary(summaryArgs);
      } else {
        await writeSessionSummary(summaryArgs);
      }
      // EC-3: trigger sync so the next memory_search({corpus:"sessions"})
      // sees the just-written summary. Fire-and-forget; the read path
      // tolerates a missed sync because IndexManager re-scans on each call.
      //
      // SDK 2.0 Phase 1 physical Stage 2b — iter 26: under
      // `THEOKIT_PORT_MEMORY_PATH=1` the agent-loop already fired
      // `provider.sync()` post-finished-run. Calling syncIfReady() here
      // would be redundant (double sync). Skip when flag is on.
      if (!shouldUsePortMemoryPath()) {
        void memoryGlue.syncIfReady();
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      process.stderr.write(
        `[theokit-sdk] session summary write failed (${result.id}): ${message}\n`,
      );
    }
  }

  await hooksExecutor.run({
    event: "postRun",
    output: {
      status: result.status,
      ...(result.result !== undefined ? { result: result.result } : {}),
    },
    agentId,
    runId: result.id,
  });
  await flushSessionWrites();
}

/**
 * Read the rich per-turn conversation view for transcript persistence. Best-effort:
 * a run without `conversation()` (or one that throws) yields `[]` so persistence
 * degrades to the user turn only rather than crashing the post-run lifecycle.
 */
async function safeConversation(run: Run): Promise<Awaited<ReturnType<Run["conversation"]>>> {
  try {
    return await run.conversation();
  } catch {
    return [];
  }
}
