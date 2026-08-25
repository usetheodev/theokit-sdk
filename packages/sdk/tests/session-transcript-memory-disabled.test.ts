/**
 * usetheokit/theokit-sdk#382 — a disabled memory store must not write to the consumer's repository.
 *
 * Reproduced 2026-08-25 in a fresh git repo: an agent built with `memory: { enabled: false }` still
 * had `<cwd>/.theokit/memory/sessions/run-<id>.md` created on the first finished turn, carrying the
 * full user prompt and assistant reply. `runPostRunLifecycle` gated the write on the run's STATUS
 * (ADR D20 + EC-9) and on nothing else, while every other memory surface — `ensureTools`,
 * `persistMemoryFactIfWritePrompt`, `readMemoryForSend` — already returned early on the flag. So
 * "memory is off" was true of the subsystem except for the one part that writes files into someone
 * else's git repository.
 *
 * TWO LAYERS, DELIBERATELY. The end-to-end case goes through `Agent.create().send()` because the
 * defect is not in the writer — the writer was doing what it was told — it is in the WIRING that
 * never told it anything. A lifecycle-level test alone would pass against a `LocalAgent` that
 * forgot to forward `options.memory`, which is precisely the mistake available here. The
 * lifecycle-level cases then pin the decision itself, including the port path, which the
 * end-to-end case cannot reach without an env flag.
 *
 * Anti-vacuity: every "nothing was written" assertion is paired with the same run under the DEFAULT
 * configuration, which must produce the file. Without that pair, a run that silently failed before
 * reaching the writer would read as a fix.
 */

import { access, mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { Agent } from "../src/agent.js";
import { LocalAgentMemory } from "../src/internal/local-agent/local-agent-memory.js";
import { FsSessionStore } from "../src/internal/persistence/fs-session-store.js";
import { HooksExecutor } from "../src/internal/runtime/hooks/hooks-executor.js";
import {
  runPostRunLifecycle,
  sessionTranscriptAllowed,
} from "../src/internal/runtime/lifecycle/post-run-lifecycle.js";
import type {
  MemoryProvider,
  RecordSessionSummaryArgs,
} from "../src/internal/runtime/memory/memory-provider.js";
import type { AgentOptions, MemorySettings } from "../src/types/agent.js";
import type { MemoryAdapter } from "../src/types/memory-adapter.js";
import type { Run, RunResult } from "../src/types/run.js";
import { removeTempDirRobust } from "./helpers/temp-workspace.js";

/** The user turn the assertions look for on disk. Distinctive so a substring match means something. */
const PROMPT = "what changed in the ledger reconciliation?";

const FINISHED_RESULT: RunResult = {
  id: "run-382",
  status: "finished",
  result: "the answer is 42",
};

function buildStubRun(result: RunResult): Run {
  return {
    id: result.id,
    agentId: "transcript-agent",
    model: undefined,
    sendOptions: {} as never,
    // biome-ignore lint/correctness/useYield: stub generator for the test — no events to yield
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

function stubAdapter(): MemoryAdapter {
  return {
    id: "spy",
    capabilities: {
      history: false,
      sessions: false,
      tenancy: false,
      reasoning: false,
      toolSchemas: false,
      prefetch: false,
    },
    isAvailable: () => true,
    write: async () => "spy:noop" as never,
    recall: async () => [],
    delete: async () => undefined,
  };
}

/** True when the sessions directory exists at all — its file is named for a runId nothing fixes. */
async function sessionsDirExists(cwd: string): Promise<boolean> {
  try {
    await access(join(cwd, ".theokit", "memory", "sessions"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Every file under `<cwd>/.theokit` whose text contains `needle`, as repo-relative paths.
 *
 * Asserting on one known filename would be vacuous here: the transcript is named for a random
 * runId, so `readFile("run-382.md")` rejects whether or not the fix works. Searching the subtree
 * asks the question the report actually asked — did the prompt reach the consumer's repository at
 * all — and keeps catching it if the write ever moves to a different path under `.theokit`.
 */
async function filesUnderTheokitContaining(cwd: string, needle: string): Promise<string[]> {
  const root = join(cwd, ".theokit");
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => []);
  const hits: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = join(entry.parentPath, entry.name);
    const text = await readFile(full, "utf8").catch(() => "");
    if (text.includes(needle)) hits.push(full.slice(cwd.length + 1));
  }
  return hits;
}

describe("session transcript honours `memory.enabled`", () => {
  let cwd: string;
  let sessionDir: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-382-cwd-"));
    sessionDir = await mkdtemp(join(tmpdir(), "theokit-382-home-"));
    const dir = cwd;
    onTestFinished(async () => {
      await removeTempDirRobust(dir);
    });
  });

  /**
   * One finished turn in fixture mode, then a wait the intermediate state cannot satisfy.
   *
   * `run.wait()` is NOT that wait: the post-run lifecycle runs after the run resolves, so the
   * transcript decision has not been taken yet when it returns — reading the filesystem there
   * reports "no file" for both the fixed and the unfixed tree. `dispose()` takes the per-agent send
   * mutex that the lifecycle holds (ADR D19), so it cannot return until the write has happened or
   * been skipped. That is the signal the code under test itself uses.
   */
  async function sendOneTurn(memory: MemorySettings | undefined): Promise<void> {
    const agent = await Agent.create({
      apiKey: "theo_test_382",
      model: { id: "claude-sonnet-4-6" },
      local: { cwd, sessionDir },
      ...(memory !== undefined ? { memory } : {}),
    });
    const run = await agent.send(PROMPT);
    await run.wait();
    await agent.dispose();
  }

  it("test_a_default_agent_still_writes_the_session_transcript", async () => {
    // The control, and the reason the next two cases mean anything. It is also the behaviour
    // #382 deliberately does NOT change: an agent that never mentioned `memory` keeps writing,
    // because that file is what `memory_search({ corpus: "sessions" })` reads once memory is
    // switched on, and silently emptying that corpus would bill a change to people who asked for
    // nothing.
    await sendOneTurn(undefined);

    expect(
      await sessionsDirExists(cwd),
      "the unconfigured default must keep writing, or the disabled cases prove nothing",
    ).toBe(true);
  });

  it("test_no_transcript_is_written_when_memory_is_disabled", async () => {
    await sendOneTurn({ enabled: false });

    expect(
      await sessionsDirExists(cwd),
      `memory was disabled and ${join(cwd, ".theokit/memory/sessions")} was created anyway`,
    ).toBe(false);
  });

  it("test_the_prompt_reaches_disk_under_the_default_configuration", async () => {
    // Pins WHAT the file held, which is what made #382 a report rather than a tidiness complaint:
    // the user's own words, inside their repository. It is also the control for the case below.
    await sendOneTurn(undefined);

    const hits = await filesUnderTheokitContaining(cwd, PROMPT);
    expect(hits, "the default agent must write the prompt somewhere under .theokit").toHaveLength(
      1,
    );
    expect(hits[0]).toMatch(/^\.theokit[/\\]memory[/\\]sessions[/\\]run-.+\.md$/);
  });

  it("test_the_prompt_never_reaches_disk_when_memory_is_disabled", async () => {
    await sendOneTurn({ enabled: false });

    const hits = await filesUnderTheokitContaining(cwd, PROMPT);
    expect(
      hits,
      `the prompt was written to ${hits.join(", ")} despite memory being disabled`,
    ).toEqual([]);
  });

  it("test_a_transcript_is_written_when_memory_is_enabled", async () => {
    await sendOneTurn({ enabled: true });

    expect(await sessionsDirExists(cwd)).toBe(true);
  });

  it("test_the_legacy_writer_is_skipped_at_the_lifecycle_when_memory_is_disabled", async () => {
    const hooks = new HooksExecutor(cwd);
    await hooks.initialize(false);
    const options = { memory: { enabled: false } } as AgentOptions;

    await runPostRunLifecycle({
      run: buildStubRun(FINISHED_RESULT),
      userText: "user question",
      agentId: "transcript-agent",
      workspaceCwd: cwd,
      sessionStore: new FsSessionStore({ baseDir: sessionDir, cwd }),
      model: "stub-model",
      hooksExecutor: hooks,
      memoryGlue: new LocalAgentMemory(options, cwd, "transcript-agent"),
      memory: { enabled: false },
    });

    expect(await sessionsDirExists(cwd)).toBe(false);
  });

  it("test_the_memory_port_recorder_is_not_invoked_when_memory_is_disabled", async () => {
    // The port path is the second writer. Gating only the legacy call would leave
    // `THEOKIT_PORT_MEMORY_PATH=1` writing the same transcript through a different door.
    const recordSpy = vi.fn(async (_args: RecordSessionSummaryArgs) => {});
    const provider: MemoryProvider = {
      init: async () => ({ adapter: stubAdapter() }),
      buildTools: () => [],
      runActivePass: async () => ({ facts: [] }),
      recordSessionSummary: recordSpy,
      dispose: () => undefined,
    };
    const hooks = new HooksExecutor(cwd);
    await hooks.initialize(false);
    const options = { memory: { enabled: false } } as AgentOptions;

    await runPostRunLifecycle({
      run: buildStubRun(FINISHED_RESULT),
      userText: "user question",
      agentId: "transcript-agent",
      workspaceCwd: cwd,
      sessionStore: new FsSessionStore({ baseDir: sessionDir, cwd }),
      model: "stub-model",
      hooksExecutor: hooks,
      memoryGlue: new LocalAgentMemory(options, cwd, "transcript-agent"),
      memoryProvider: provider,
      memory: { enabled: false },
    });

    expect(recordSpy, "the port recorder ran for a disabled memory store").not.toHaveBeenCalled();
  });

  it("test_the_memory_port_recorder_is_invoked_when_memory_is_unset", async () => {
    const recordSpy = vi.fn(async (_args: RecordSessionSummaryArgs) => {});
    const provider: MemoryProvider = {
      init: async () => ({ adapter: stubAdapter() }),
      buildTools: () => [],
      runActivePass: async () => ({ facts: [] }),
      recordSessionSummary: recordSpy,
      dispose: () => undefined,
    };
    const hooks = new HooksExecutor(cwd);
    await hooks.initialize(false);

    await runPostRunLifecycle({
      run: buildStubRun(FINISHED_RESULT),
      userText: "user question",
      agentId: "transcript-agent",
      workspaceCwd: cwd,
      sessionStore: new FsSessionStore({ baseDir: sessionDir, cwd }),
      model: "stub-model",
      hooksExecutor: hooks,
      memoryGlue: new LocalAgentMemory({} as AgentOptions, cwd, "transcript-agent"),
      memoryProvider: provider,
    });

    expect(recordSpy).toHaveBeenCalledTimes(1);
  });
});

describe("sessionTranscriptAllowed", () => {
  it("test_an_absent_memory_config_still_allows_the_write", () => {
    expect(sessionTranscriptAllowed(undefined)).toBe(true);
  });

  it("test_enabled_false_forbids_the_write", () => {
    expect(sessionTranscriptAllowed({ enabled: false })).toBe(false);
  });

  it("test_enabled_true_allows_the_write", () => {
    expect(sessionTranscriptAllowed({ enabled: true })).toBe(true);
  });
});
