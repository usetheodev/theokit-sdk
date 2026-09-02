/**
 * The minimally valid `AgentLoopInputs`, in one place.
 *
 * Nine files in this directory each declared their own `makeInputs`, and none of the nine was
 * identical to another — same nine fields, five different signatures, five different agentId
 * strings. That is duplicated KNOWLEDGE rather than duplicated code: adding a required field to
 * `AgentLoopInputs` forces the same edit nine times, and the ninth is the one somebody misses.
 *
 * The signature is `(overrides)` rather than `(llm, opts)` because the copies disagreed about which
 * argument deserved to be positional — `llm`, `agentId`, `agentId + llm`, `run` — and a factory that
 * privileges one of them just reproduces that argument.
 *
 * NOT migrated, deliberately: `stop-hook-reflection.test.ts` and `tool-context-threadid.test.ts`
 * build a two-field object behind `as unknown as AgentLoopInputs`. Those are testing code that reads
 * exactly those fields, and handing them a fully-populated object — with a real `HooksExecutor` —
 * would widen what the unit under test can reach. Their casts are a deliberate narrowing, not a
 * shortcut.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";
import type { AgentLoopInputs } from "../../../../src/internal/agent-loop/types.js";
import { HooksExecutor } from "../../../../src/internal/runtime/hooks/hooks-executor.js";
import { removeTempDirRobust } from "../../../helpers/temp-workspace.js";

/**
 * @param overrides - Merged over the defaults. `llm` has no default and must be supplied by any
 *   caller that actually runs the loop.
 */
export function makeLoopInputs(overrides: Partial<AgentLoopInputs> = {}): AgentLoopInputs {
  return {
    agentId: "agent-loop-test",
    runId: "run-1",
    userMessage: "hi",
    model: { id: "mock-model" },
    mcp: new Map(),
    hooks: new HooksExecutor(process.cwd()),
    shellCwd: process.cwd(),
    shellSandbox: false,
    ...overrides,
  } as AgentLoopInputs;
}

/**
 * A disposable cwd with an initialized {@link HooksExecutor} pointing at it.
 *
 * The pair appeared verbatim in every test in this directory that runs the real loop: `mkdtemp`,
 * an `onTestFinished` that removes it robustly, `new HooksExecutor(cwd)`, `await initialize(false)`.
 * Four statements of ceremony before the first line about the behaviour under test.
 *
 * MUST be called from inside a test — `onTestFinished` is only legal there. A `beforeAll` fixture
 * needs its own `afterAll`; that mistake cost eleven silently skipped tests once already.
 */
export async function makeLoopWorkspace(
  prefix: string,
): Promise<{ cwd: string; hooks: HooksExecutor }> {
  const cwd = await mkdtemp(join(tmpdir(), prefix));
  onTestFinished(async () => {
    await removeTempDirRobust(cwd);
  });
  const hooks = new HooksExecutor(cwd);
  await hooks.initialize(false);
  return { cwd, hooks };
}
