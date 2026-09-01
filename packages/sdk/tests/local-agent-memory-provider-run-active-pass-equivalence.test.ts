/**
 * `runActivePass` equivalence test (Phase 1 physical Stage 2b — iter 19+).
 *
 * Verifies: for the SAME `LocalAgentMemory` state, calling
 * `adapter.runActivePass()` returns the same `systemPromptAdditions`
 * value that `glue.runActiveMemoryIfEnabled()` would return directly.
 *
 * Complements the buildTools equivalence test
 * (`local-agent-memory-provider-equivalence.test.ts`) by covering the
 * second of the three legacy → port translation surfaces (the third
 * being `sync` ↔ `syncIfReady`, which is trivial — adapter calls
 * `syncIfReady()` verbatim).
 *
 * With memory disabled (test default), `runActiveMemoryIfEnabled`
 * returns `undefined` and the adapter returns `{ facts: [] }` with no
 * `systemPromptAdditions`. Both are equivalent at the system-prompt
 * concat layer (no addition added).
 */

import { describe, expect, it } from "vitest";
import { LocalAgentMemory } from "../src/internal/local-agent/local-agent-memory.js";
import { createLocalAgentMemoryProvider } from "../src/internal/local-agent/local-agent-memory-provider.js";
import type { AgentOptions } from "../src/types/agent.js";

const AGENT_OPTIONS: AgentOptions = {
  agentId: "rap-eq-agent",
  model: { id: "anthropic/claude-3-5-haiku-latest" },
} as AgentOptions;

describe("runActivePass equivalence (Stage 2b iter 19+)", () => {
  it("test_memory_disabled_both_produce_no_additions", async () => {
    // Legacy direct call
    const glue = new LocalAgentMemory(AGENT_OPTIONS, "/tmp/rap-eq", "rap-eq-agent");
    const legacy = await glue.runActiveMemoryIfEnabled("hi there", [], undefined);
    expect(legacy).toBeUndefined();

    // Port via adapter
    const provider = createLocalAgentMemoryProvider({
      agentOptions: AGENT_OPTIONS,
      workspaceCwd: "/tmp/rap-eq",
      agentId: "rap-eq-agent",
    });
    const handle = await provider.init({ cwd: "/tmp/rap-eq" });
    const adapted = await provider.runActivePass(handle, {
      userMessage: "hi there",
      history: [],
      agentId: "rap-eq-agent",
    });
    expect(adapted.facts).toEqual([]);
    expect(adapted.systemPromptAdditions).toBeUndefined();

    // Equivalence at the system-prompt concat layer:
    //   legacy === undefined → no concat
    //   adapted.systemPromptAdditions === undefined → no concat
  });

  it("test_history_shape_translation_preserves_order", async () => {
    // The port passes `history: [{role, content}]`; adapter translates
    // to legacy's `[{role, text}]` shape before calling
    // `runActiveMemoryIfEnabled`. Pin the translation ordering.
    const provider = createLocalAgentMemoryProvider({
      agentOptions: AGENT_OPTIONS,
      workspaceCwd: "/tmp/rap-eq",
      agentId: "rap-eq-agent",
    });
    const handle = await provider.init({ cwd: "/tmp/rap-eq" });
    // No throw + memory disabled → empty facts; the translation
    // happens INSIDE the adapter even on the disabled path.
    const result = await provider.runActivePass(handle, {
      userMessage: "summarize",
      history: [
        { role: "user", content: "first" },
        { role: "assistant", content: "second" },
        { role: "user", content: "third" },
      ],
      agentId: "rap-eq-agent",
    });
    expect(result).toEqual({ facts: [] });
    // (If we could observe the inner runActiveMemoryIfEnabled call's
    // priorMessages arg, we'd assert ordering preserved exactly.
    // That requires a spy on the glue method — covered by
    // `local-agent-memory-provider.test.ts` history-translation test
    // already; this test ensures the path doesn't reject the args.)
  });

  it("test_returned_payload_shape_invariant", async () => {
    // ActiveMemoryPassResult MUST have `facts: ReadonlyArray<MemoryFact>`
    // at minimum. systemPromptAdditions + breakerTripped are optional.
    const provider = createLocalAgentMemoryProvider({
      agentOptions: AGENT_OPTIONS,
      workspaceCwd: "/tmp/rap-eq",
      agentId: "rap-eq-agent",
    });
    const handle = await provider.init({ cwd: "/tmp/rap-eq" });
    const result = await provider.runActivePass(handle, {
      userMessage: "x",
      history: [],
      agentId: "rap-eq-agent",
    });
    // Required field present
    expect(Array.isArray(result.facts)).toBe(true);
    // Optional fields default to undefined (no spurious set)
    expect(result.systemPromptAdditions).toBeUndefined();
    expect(result.breakerTripped).toBeUndefined();
  });

  it("test_concat_semantics_match_loop_resolveSystemPromptWithMemoryAdditions", async () => {
    // The agent-loop concats `inputs.systemPrompt` +
    // `ctx.memorySystemPromptAdditions` via
    // `resolveSystemPromptWithMemoryAdditions`. Replicate the function
    // pure-ly here + verify the legacy + port paths both produce a
    // concat-compatible result when memory is disabled.
    function resolveSystemPromptWithMemoryAdditions(
      systemPrompt: string | undefined,
      additions: string | undefined,
    ): string | undefined {
      if (additions === undefined || additions.length === 0) return systemPrompt;
      if (systemPrompt === undefined || systemPrompt.length === 0) return additions;
      return `${systemPrompt}\n\n${additions}`;
    }
    const glue = new LocalAgentMemory(AGENT_OPTIONS, "/tmp/rap-eq", "rap-eq-agent");
    const legacy = await glue.runActiveMemoryIfEnabled("u", [], undefined);
    // Legacy: pass `legacy` (undefined) as additions to the resolver.
    expect(resolveSystemPromptWithMemoryAdditions("you are a bot", legacy)).toBe("you are a bot");

    const provider = createLocalAgentMemoryProvider({
      agentOptions: AGENT_OPTIONS,
      workspaceCwd: "/tmp/rap-eq",
      agentId: "rap-eq-agent",
    });
    const handle = await provider.init({ cwd: "/tmp/rap-eq" });
    const port = await provider.runActivePass(handle, {
      userMessage: "u",
      history: [],
      agentId: "rap-eq-agent",
    });
    // Port: pass `port.systemPromptAdditions` (undefined) — same result.
    expect(
      resolveSystemPromptWithMemoryAdditions("you are a bot", port.systemPromptAdditions),
    ).toBe("you are a bot");
  });
});
