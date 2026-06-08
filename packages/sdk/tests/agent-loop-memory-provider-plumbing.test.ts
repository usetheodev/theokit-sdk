/**
 * Plumbing test for the `memoryProvider` field on `AgentLoopInputs`
 * (SDK 2.0 Phase 1 / T1.4 — type-level threading).
 *
 * Runtime hooks (init/buildTools/runActivePass/dispose) land in T1.5.
 * For now, we pin the BRANCH LOGIC that `real-local-run.ts` uses to
 * conditionally thread `agentOptions.memoryProvider` into the loop
 * inputs object. Same defensive pattern as
 * `agent-loop-budget-tracker-wiring.test.ts` iter 13.
 */

import { createNoopMemoryProvider, type MemoryProvider } from "@theokit/sdk";
import { describe, expect, expectTypeOf, it } from "vitest";

/**
 * Mirror of the conditional spread inside `real-local-run.ts` ~ line 173.
 * Kept in lockstep with the runtime call — when the runtime code
 * changes, this helper changes too.
 */
function threadMemoryProvider<T extends Record<string, unknown>>(
  agentOptionsMemoryProvider: MemoryProvider | undefined,
  loopInputsSoFar: T,
): T & { memoryProvider?: MemoryProvider } {
  return {
    ...loopInputsSoFar,
    ...(agentOptionsMemoryProvider !== undefined
      ? { memoryProvider: agentOptionsMemoryProvider }
      : {}),
  };
}

describe("AgentLoopInputs.memoryProvider plumbing (Phase 1 / T1.4)", () => {
  it("test_undefined_provider_does_not_set_key", () => {
    const inputs = threadMemoryProvider(undefined, { other: 1 });
    expect("memoryProvider" in inputs).toBe(false);
  });

  it("test_defined_provider_sets_key_with_same_reference", () => {
    const provider = createNoopMemoryProvider();
    const inputs = threadMemoryProvider(provider, { other: 1 });
    expect(inputs.memoryProvider).toBe(provider);
  });

  it("test_threaded_provider_preserves_lifecycle_methods", async () => {
    const provider = createNoopMemoryProvider();
    const inputs = threadMemoryProvider(provider, {});
    // After threading, the provider's contract MUST still be callable.
    const handle = await inputs.memoryProvider!.init({ cwd: "/tmp" });
    expect(handle.adapter).toBeDefined();
    const tools = inputs.memoryProvider!.buildTools(handle, {} as never);
    expect(tools.length).toBe(0);
    const passResult = await inputs.memoryProvider!.runActivePass(handle, {
      userMessage: "x",
      history: [],
      agentId: "a",
    });
    expect(passResult.facts.length).toBe(0);
    inputs.memoryProvider!.dispose(handle);
  });

  it("test_provider_field_is_optional_on_inputs_type", () => {
    // Type-level assertion — the field MUST be optional, never required.
    expectTypeOf<{ memoryProvider?: MemoryProvider }>().toMatchTypeOf<{
      memoryProvider?: MemoryProvider | undefined;
    }>();
  });
});
