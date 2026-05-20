import type { Run } from "../../types/run.js";
import { writeSessionSummary } from "../memory/session-summary-writer.js";
import { appendSessionMessage, flushSessionWrites } from "./agent-session.js";
import type { HooksExecutor } from "./hooks-executor.js";
import type { LocalAgentMemory } from "./local-agent-memory.js";

/**
 * Inputs for {@link runPostRunLifecycle}. Bundled into a single record so the
 * caller (LocalAgent.send) doesn't carry a long positional argument list.
 *
 * @internal
 */
export interface PostRunLifecycleInputs {
  run: Run;
  userText: string;
  agentId: string;
  workspaceCwd: string;
  hooksExecutor: HooksExecutor;
  memoryGlue: LocalAgentMemory;
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
  const { run, userText, agentId, workspaceCwd, hooksExecutor, memoryGlue } = inputs;
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
    appendSessionMessage(agentId, { role: "assistant", text: result.result }, workspaceCwd);
  }

  // ADR D20 + EC-9: only finished runs feed the corpus="sessions" index.
  if (result.status === "finished" && result.result !== undefined) {
    try {
      await writeSessionSummary({
        cwd: workspaceCwd,
        runId: result.id,
        agentId,
        userText,
        assistantText: result.result,
        status: "finished",
        at: Date.now(),
      });
      // EC-3: trigger sync so the next memory_search({corpus:"sessions"})
      // sees the just-written summary. Fire-and-forget; the read path
      // tolerates a missed sync because IndexManager re-scans on each call.
      void memoryGlue.syncIfReady();
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
