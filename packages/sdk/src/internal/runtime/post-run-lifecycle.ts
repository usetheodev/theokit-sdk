import type { ConversationStorageAdapter } from "../../types/conversation-storage.js";
import type { Run } from "../../types/run.js";
import { writeSessionSummary } from "../memory/storage/session-summary-writer.js";
import type { HooksExecutor } from "./hooks/hooks-executor.js";
import type { LocalAgentMemory } from "./local-agent/local-agent-memory.js";
import { shouldUsePortMemoryPath } from "./memory/memory-path-selector.js";
import type { MemoryProvider } from "./memory/memory-provider.js";
import { appendSessionMessage, flushSessionWrites } from "./session/agent-session.js";

/**
 * Inputs for {@link runPostRunLifecycle}. Bundled into a single record so the
 * caller (LocalAgent.send) doesn't carry a long positional argument list.
 *
 * `storageHandle` is the unified routing key (D304): either a
 * {@link ConversationStorageAdapter} or the raw `workspaceCwd` string when
 * no custom adapter is configured.
 *
 * @internal
 */
export interface PostRunLifecycleInputs {
  run: Run;
  userText: string;
  agentId: string;
  workspaceCwd: string;
  storageHandle: ConversationStorageAdapter | string;
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
    storageHandle,
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
    appendSessionMessage(agentId, { role: "assistant", text: result.result }, storageHandle);
  }

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
