import type { ConversationStorageAdapter } from "../../types/conversation-storage.js";
import type { Run } from "../../types/run.js";
import { writeSessionSummary } from "../memory/storage/session-summary-writer.js";
import { appendSessionMessage, flushSessionWrites } from "./agent-session.js";
import type { HooksExecutor } from "./hooks-executor.js";
import type { LocalAgentMemory } from "./local-agent-memory.js";
import { shouldUsePortMemoryPath } from "./memory-path-selector.js";
import type { MemoryProvider, MemoryProviderHandle } from "./memory-provider.js";

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
   * SDK 2.0 Phase 1 physical Stage 3 prep — iter 27: optional
   * port-based session-summary recorder. When supplied AND the
   * provider implements `recordSessionSummary`, the kernel delegates
   * the write through the port. When absent, falls back to the
   * legacy direct `writeSessionSummary` import (current behavior).
   */
  memoryProvider?: MemoryProvider;
  /**
   * Handle from `provider.init()`. Required when `memoryProvider` is
   * supplied; ignored otherwise.
   */
  memoryProviderHandle?: MemoryProviderHandle;
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
    memoryProviderHandle,
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
      runId: result.id,
      agentId,
      userText,
      assistantText: result.result,
      status: "finished" as const,
      at: Date.now(),
    };
    try {
      // SDK 2.0 Phase 1 physical Stage 3 prep — iter 27: prefer the
      // port-based `provider.recordSessionSummary` when wired. Falls
      // back to the direct `writeSessionSummary` import otherwise
      // (legacy behavior). Both paths handle the markdown write +
      // disk persistence; the difference is just WHERE the impl lives.
      if (
        memoryProvider?.recordSessionSummary !== undefined &&
        memoryProviderHandle !== undefined
      ) {
        await memoryProvider.recordSessionSummary(memoryProviderHandle, summaryArgs);
      } else {
        await writeSessionSummary({ cwd: workspaceCwd, ...summaryArgs });
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
