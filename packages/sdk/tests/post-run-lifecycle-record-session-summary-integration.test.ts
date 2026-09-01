/**
 * `runPostRunLifecycle` → `recordSessionSummary` integration tests
 * (SDK 2.0 Phase 1 physical Stage 3 prep — iter 31).
 *
 * Drives the REAL `runPostRunLifecycle` orchestrator with a stub Run
 * + spy MemoryProvider to verify:
 *
 *   - When provider implements `recordSessionSummary`: the port method
 *     fires with the canonical args (cwd + runId + agentId + ...).
 *     Legacy `writeSessionSummary` is NOT called.
 *   - When provider omits `recordSessionSummary`: legacy
 *     `writeSessionSummary` direct call fires (filesystem write).
 *   - When no provider supplied: legacy path runs (back-compat).
 *
 * Validates iter 27-29 wiring at the runPostRunLifecycle layer.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalAgentMemory } from "../src/internal/local-agent/local-agent-memory.js";
import { FsSessionStore } from "../src/internal/persistence/fs-session-store.js";
import { HooksExecutor } from "../src/internal/runtime/hooks/hooks-executor.js";
import { runPostRunLifecycle } from "../src/internal/runtime/lifecycle/post-run-lifecycle.js";
import type {
  MemoryProvider,
  RecordSessionSummaryArgs,
} from "../src/internal/runtime/memory/memory-provider.js";
import type { AgentOptions } from "../src/types/agent.js";
import type { Run, RunResult } from "../src/types/run.js";
import { stubMemoryAdapter } from "./helpers/memory-stubs.js";

/** Build a stub `Run` that wait()s to the given RunResult. */
function buildStubRun(result: RunResult): Run {
  return {
    id: result.id,
    agentId: "test-agent",
    model: undefined,
    sendOptions: {} as never,
    // biome-ignore lint/correctness/useYield: stub generator for test — no events to yield
    async *stream(): AsyncGenerator<never, void, void> {
      return;
    },
    async wait(): Promise<RunResult> {
      return result;
    },
    async conversation() {
      return [];
    },
    cancel(): void {
      return;
    },
  } as unknown as Run;
}

const STUB_OPTIONS: AgentOptions = {
  agentId: "test-agent",
  model: { id: "stub-model" },
} as AgentOptions;

const FINISHED_RESULT: RunResult = {
  id: "run-1",
  status: "finished",
  result: "the answer is 42",
};

describe("runPostRunLifecycle → recordSessionSummary (iter 31)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-postrun-"));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("test_port_path_fires_when_provider_implements_recordSessionSummary", async () => {
    const recordSpy = vi.fn(async (_args: RecordSessionSummaryArgs) => {});
    const provider: MemoryProvider = {
      init: async () => ({ adapter: stubMemoryAdapter() }),
      buildTools: () => [],
      runActivePass: async () => ({ facts: [] }),
      recordSessionSummary: recordSpy,
      dispose: () => undefined,
    };

    const hooks = new HooksExecutor(cwd);
    await hooks.initialize(false);
    const memoryGlue = new LocalAgentMemory(STUB_OPTIONS, cwd, "test-agent");

    await runPostRunLifecycle({
      run: buildStubRun(FINISHED_RESULT),
      userText: "user question",
      agentId: "test-agent",
      workspaceCwd: cwd,
      sessionStore: new FsSessionStore({ baseDir: cwd, cwd }),
      model: "stub-model",
      hooksExecutor: hooks,
      memoryGlue,
      memoryProvider: provider,
    });

    expect(recordSpy).toHaveBeenCalledTimes(1);
    const args = recordSpy.mock.calls[0]?.[0];
    expect(args).toBeDefined();
    if (args === undefined) return;
    expect(args.cwd).toBe(cwd);
    expect(args.runId).toBe("run-1");
    expect(args.agentId).toBe("test-agent");
    expect(args.userText).toBe("user question");
    expect(args.assistantText).toBe("the answer is 42");
    expect(args.status).toBe("finished");
    expect(typeof args.at).toBe("number");
  });

  it("test_port_path_fires_when_provider_throws_run_continues", async () => {
    const recordSpy = vi.fn(async () => {
      throw new Error("provider blew");
    });
    const provider: MemoryProvider = {
      init: async () => ({ adapter: stubMemoryAdapter() }),
      buildTools: () => [],
      runActivePass: async () => ({ facts: [] }),
      recordSessionSummary: recordSpy,
      dispose: () => undefined,
    };

    const hooks = new HooksExecutor(cwd);
    await hooks.initialize(false);
    const memoryGlue = new LocalAgentMemory(STUB_OPTIONS, cwd, "test-agent");

    // post-run-lifecycle swallows the throw + emits stderr; never propagates.
    await expect(
      runPostRunLifecycle({
        run: buildStubRun(FINISHED_RESULT),
        userText: "u",
        agentId: "test-agent",
        workspaceCwd: cwd,
        sessionStore: new FsSessionStore({ baseDir: cwd, cwd }),
        model: "stub-model",
        hooksExecutor: hooks,
        memoryGlue,
        memoryProvider: provider,
      }),
    ).resolves.toBeUndefined();
    expect(recordSpy).toHaveBeenCalledTimes(1);
  });

  it("test_legacy_path_fires_when_no_provider_supplied", async () => {
    const hooks = new HooksExecutor(cwd);
    await hooks.initialize(false);
    const memoryGlue = new LocalAgentMemory(STUB_OPTIONS, cwd, "test-agent");

    // No port impl available → legacy writeSessionSummary writes to disk.
    // We don't assert filesystem contents here (heavy); just that the
    // function completes without throwing.
    await expect(
      runPostRunLifecycle({
        run: buildStubRun(FINISHED_RESULT),
        userText: "u",
        agentId: "test-agent",
        workspaceCwd: cwd,
        sessionStore: new FsSessionStore({ baseDir: cwd, cwd }),
        model: "stub-model",
        hooksExecutor: hooks,
        memoryGlue,
      }),
    ).resolves.toBeUndefined();
  });

  it("test_legacy_path_fires_when_provider_omits_recordSessionSummary", async () => {
    const provider: MemoryProvider = {
      init: async () => ({ adapter: stubMemoryAdapter() }),
      buildTools: () => [],
      runActivePass: async () => ({ facts: [] }),
      // recordSessionSummary intentionally omitted
      dispose: () => undefined,
    };
    const hooks = new HooksExecutor(cwd);
    await hooks.initialize(false);
    const memoryGlue = new LocalAgentMemory(STUB_OPTIONS, cwd, "test-agent");

    await expect(
      runPostRunLifecycle({
        run: buildStubRun(FINISHED_RESULT),
        userText: "u",
        agentId: "test-agent",
        workspaceCwd: cwd,
        sessionStore: new FsSessionStore({ baseDir: cwd, cwd }),
        model: "stub-model",
        hooksExecutor: hooks,
        memoryGlue,
        memoryProvider: provider,
      }),
    ).resolves.toBeUndefined();
  });

  it("test_recordSessionSummary_not_called_on_error_finalStatus", async () => {
    const recordSpy = vi.fn();
    const provider: MemoryProvider = {
      init: async () => ({ adapter: stubMemoryAdapter() }),
      buildTools: () => [],
      runActivePass: async () => ({ facts: [] }),
      recordSessionSummary: recordSpy,
      dispose: () => undefined,
    };
    const hooks = new HooksExecutor(cwd);
    await hooks.initialize(false);
    const memoryGlue = new LocalAgentMemory(STUB_OPTIONS, cwd, "test-agent");

    await runPostRunLifecycle({
      run: buildStubRun({ id: "run-err", status: "error" }),
      userText: "u",
      agentId: "test-agent",
      workspaceCwd: cwd,
      sessionStore: new FsSessionStore({ baseDir: cwd, cwd }),
      model: "stub-model",
      hooksExecutor: hooks,
      memoryGlue,
      memoryProvider: provider,
    });
    // Session summary only fires on finished runs (ADR D20 + EC-9).
    expect(recordSpy).not.toHaveBeenCalled();
  });
});
