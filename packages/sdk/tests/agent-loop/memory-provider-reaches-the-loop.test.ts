/**
 * The wiring that carries a CONSUMER's own MemoryProvider into the agent loop, at the two sites that
 * actually decide it.
 *
 * Measured 2026-09-01: replacing the conditional spread at `real-local-run.ts:350` with `false` — so
 * a consumer-supplied provider is NEVER threaded into the loop — left FIFTEEN tests green across
 * memory-provider-plumbing, -lifecycle and -integration. The mirror that used to sit in the plumbing
 * test is why: it re-implemented the spread and asserted against its own copy, occupying the seat
 * coverage would have taken while proving that object spread works.
 *
 * The two sites are INDEPENDENT and a fix to one leaves the other unguarded, which is why there are
 * two tests here and not one:
 *
 *   - Run-driven — `createRealLocalRun` → `buildLoopInputs` (real-local-run.ts:205-352), the
 *     conditional spread. Observable: what `runAgentLoop` receives as `inputs.memoryProvider`.
 *   - send-driven — `local-agent-send.ts:177` → `resolveMemoryProviderForLoop`. Observable: what that
 *     function returns.
 *
 * Both are verified by MUTATION, not by passing: each case was re-run with its site broken.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resolveMemoryProviderForLoop } from "../../src/internal/runtime/memory-glue/memory-path-selector.js";
import type { MemoryProvider } from "../../src/internal/runtime/memory-glue/memory-provider.js";

const loopInputs: Array<Record<string, unknown>> = [];

vi.mock("../../src/internal/agent-loop/loop.js", () => ({
  runAgentLoop: vi.fn(async (inputs: Record<string, unknown>) => {
    loopInputs.push(inputs);
    return { events: [], finalStatus: "completed", result: "ok", conversation: [] };
  }),
}));

const { createRealLocalRun } = await import("../../src/internal/local-agent/real-local-run.js");

function stubProvider(id: string): MemoryProvider {
  return {
    id,
    init: vi.fn(async () => ({ handle: id })),
    buildTools: vi.fn(() => []),
    runActivePass: vi.fn(async () => undefined),
    sync: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  } as unknown as MemoryProvider;
}

describe("a consumer-supplied MemoryProvider reaches the agent loop", () => {
  beforeEach(() => {
    loopInputs.length = 0;
  });

  it("Run-driven: buildLoopInputs threads it onto the loop inputs", async () => {
    const provider = stubProvider("consumer-provider");
    const run = createRealLocalRun({
      agentId: "local-mem-wiring",
      model: { id: "claude-sonnet-4-6" },
      message: "hello",
      agentOptions: { apiKey: "sk-ant-test-key", memoryProvider: provider },
      sendOptions: {},
      workspaceCwd: process.cwd(),
      hooks: {} as never,
    } as never);
    await run.wait();

    expect(loopInputs, "the loop was never reached — this test proves nothing").toHaveLength(1);
    expect(
      loopInputs[0]?.memoryProvider,
      "the conditional spread dropped the consumer's provider on the floor",
    ).toBe(provider);
  });

  it("Run-driven: an absent provider stays absent rather than becoming a default", async () => {
    const run = createRealLocalRun({
      agentId: "local-mem-wiring-none",
      model: { id: "claude-sonnet-4-6" },
      message: "hello",
      agentOptions: { apiKey: "sk-ant-test-key" },
      sendOptions: {},
      workspaceCwd: process.cwd(),
      hooks: {} as never,
    } as never);
    await run.wait();

    expect(loopInputs).toHaveLength(1);
    expect(loopInputs[0]).not.toHaveProperty("memoryProvider");
  });

  it("send-driven: the consumer's provider outranks the default adapter", () => {
    const consumer = stubProvider("consumer");
    const fallback = stubProvider("default");

    expect(resolveMemoryProviderForLoop(consumer, fallback, true)).toBe(consumer);
    expect(
      resolveMemoryProviderForLoop(consumer, fallback, false),
      "the port-path flag must not be able to discard what the consumer supplied",
    ).toBe(consumer);
  });

  it("send-driven: without one, the default adapter is used only on the port path", () => {
    const fallback = stubProvider("default");

    expect(resolveMemoryProviderForLoop(undefined, fallback, true)).toBe(fallback);
    expect(resolveMemoryProviderForLoop(undefined, fallback, false)).toBeUndefined();
  });
});
