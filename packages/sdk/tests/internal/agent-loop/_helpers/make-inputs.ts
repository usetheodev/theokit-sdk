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
import type { AgentLoopInputs } from "../../../../src/internal/agent-loop/loop-types.js";
import { HooksExecutor } from "../../../../src/internal/runtime/hooks/hooks-executor.js";

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
