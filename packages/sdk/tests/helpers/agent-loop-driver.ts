/**
 * Drive the real `runAgentLoop` from a test, in about as many lines as a mirror of it costs.
 *
 * WHY THIS EXISTS. Nine test files in this package tested a hand-written COPY of a loop call site
 * instead of the call site, each justifying it the same way: that `runAgentLoop` cannot be driven
 * "without a stubbed LLM (would pull a deep mock setup)". The premise was false when it was first
 * written. `LlmClient` has two members — `name` and `stream` — so the stub is ten lines, and 22 test
 * files already drove the real loop with one.
 *
 * The cost of the premise was not duplication. `agent-loop-budget-tracker-wiring.test.ts` measured
 * it: *"No mutation of the real wiring could fail anything here."* And
 * `agent-loop-budget-tracker-check-wiring.test.ts` showed the end state — its mirror had drifted
 * INVERTED, pinning a fail-open budget gate as the contract while production failed closed, and the
 * suite stayed green because two tests stating opposite contracts were not both connected to the
 * code.
 *
 * So the helper is deliberately small and un-clever: whatever it hides, a reader can still see in
 * `runAgentLoop`'s own signature. A driver that grew its own semantics would be a mirror again.
 */

import { runAgentLoop } from "../../src/internal/agent-loop/loop.js";
import type { LlmClient, LlmEvent, LlmFinish, LlmRequest } from "../../src/internal/llm/types.js";
import { HooksExecutor } from "../../src/internal/runtime/hooks/hooks-executor.js";

/** The ten-line `LlmClient` the "needs a deep mock" premise said did not exist. */
export function buildRecordingStubClient(text = "ok"): {
  client: LlmClient;
  requests: LlmRequest[];
} {
  const requests: LlmRequest[] = [];
  const client: LlmClient = {
    name: "stub",
    async *stream(
      request: LlmRequest,
      _signal: AbortSignal,
    ): AsyncGenerator<LlmEvent, LlmFinish, void> {
      requests.push(request);
      yield { type: "text_delta", text };
      return { stopReason: "end_turn", text, toolCalls: [] };
    },
  };
  return { client, requests };
}

type LoopInputs = Parameters<typeof runAgentLoop>[0];

/**
 * Run one turn of the real loop and hand back both the result and every request the model saw.
 *
 * `requests` is what makes a wiring assertion possible without a mirror: the tools a provider
 * contributed, the system prompt a pass injected, and the messages a hook rewrote are all visible in
 * what the LLM was actually asked.
 */
export async function driveLoop(
  cwd: string,
  overrides: Partial<LoopInputs> = {},
): Promise<{ result: Awaited<ReturnType<typeof runAgentLoop>>; requests: LlmRequest[] }> {
  const { client, requests } = buildRecordingStubClient();
  const hooks = new HooksExecutor(cwd);
  await hooks.initialize(false);
  const result = await runAgentLoop({
    agentId: "driver-agent",
    runId: "driver-run",
    model: { id: "stub-model" },
    userMessage: "drive",
    llm: client,
    mcp: new Map(),
    hooks,
    shellCwd: cwd,
    shellSandbox: false,
    ...overrides,
  } as LoopInputs);
  return { result, requests };
}
