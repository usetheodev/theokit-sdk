/**
 * T0.2 — Finding B regression gate (`sdk-error-packaging-fix-plan` v1.1).
 *
 * Validates that provider/transport errors propagate via `AgentLoopOutput.error`
 * (eventually `RunResult.error`) instead of being emit as `SDKAssistantMessage`
 * content. Abort path preserved as `"[aborted]"` assistant content (UX).
 *
 * Bug pre-fix: `loop.ts:307-318` catch unconditionally pushes
 * `buildAssistantEvent(text)` with cause.message — leaks errors as assistant
 * messages in `run.stream()`. theokit's `streamAgentRun` then yields
 * `{type:'message'}` instead of `{type:'error'}`.
 *
 * Tests use `runAgentLoop` directly (same injection pattern as
 * `strip-think-wiring.test.ts`) — bypass Agent.create wrapper to test catch
 * block surgically.
 */
import { describe, expect, it } from "vitest";
import { AuthenticationError } from "../../../src/errors.js";
import { runAgentLoop } from "../../../src/internal/agent-loop/loop.js";
import type { AgentLoopInputs } from "../../../src/internal/agent-loop/types.js";
import type { LlmClient, LlmEvent, LlmFinish } from "../../../src/internal/llm/types.js";
import { makeTextLlm } from "../../helpers/llm-stubs.js";
import { makeLoopInputs } from "./_helpers/make-inputs.js";

/** The envelope these two files assert on: the stub reports token counts. */
const makeTextLlmWithTokens = (content: string) =>
  makeTextLlm(content, { inputTokens: 0, outputTokens: content.length });

function makeThrowingLlm(err: Error): LlmClient {
  return {
    name: "mock",
    // biome-ignore lint/correctness/useYield: intentional non-yielding generator mock — throws before any chunk is emitted to exercise the error-packaging path
    async *stream(): AsyncGenerator<LlmEvent, LlmFinish, void> {
      throw err;
    },
  };
}

const makeInputs = (llm: LlmClient, opts: Partial<AgentLoopInputs> = {}): AgentLoopInputs =>
  makeLoopInputs({ agentId: "error-packaging-test", llm, ...opts });

// Filter assistant events that contain error-shaped content (leak detection)
function findLeakedErrorAssistant(events: ReadonlyArray<unknown>): unknown | undefined {
  return events.find((e): boolean => {
    if (typeof e !== "object" || e === null) return false;
    const ev = e as { type?: string };
    if (ev.type !== "assistant") return false;
    const json = JSON.stringify(e);
    return /API error|HTTP \d{3}|auth_failed|rate_limit/i.test(json);
  });
}

describe("agent-loop error packaging (Finding B)", () => {
  it("provider AuthenticationError → AgentLoopOutput.error populated + NO assistant leak", async () => {
    // Given: LLM throws AuthenticationError
    const err = new AuthenticationError("openrouter API error: auth_failed (HTTP 401)", {
      code: "openrouter_auth_failed",
    });
    const llm = makeThrowingLlm(err);

    // When: agent loop runs
    const output = await runAgentLoop(makeInputs(llm));

    // Then: finalStatus is error
    expect(output.finalStatus).toBe("error");
    // AgentLoopOutput must carry structured error (new field — Phase 1)
    const outputWithError = output as typeof output & {
      error?: { message: string; code?: string };
    };
    expect(outputWithError.error).toBeDefined();
    expect(outputWithError.error?.message).toContain("auth_failed");
    expect(outputWithError.error?.code).toBe("openrouter_auth_failed");
    // CRITICAL: no SDKAssistantMessage leaked with error content
    const leaked = findLeakedErrorAssistant(output.events);
    expect(leaked, "Finding B: error MUST NOT leak as assistant message content").toBeUndefined();
  });

  it("transport error (ECONNREFUSED) → AgentLoopOutput.error populated + NO assistant leak", async () => {
    // Given: LLM throws generic transport error (no .code field)
    const err = new Error("connect ECONNREFUSED 127.0.0.1:11434");
    const llm = makeThrowingLlm(err);

    // When
    const output = await runAgentLoop(makeInputs(llm));

    // Then
    expect(output.finalStatus).toBe("error");
    const outputWithError = output as typeof output & {
      error?: { message: string; code?: string };
    };
    expect(outputWithError.error?.message).toContain("ECONNREFUSED");
    // EC-1: code undefined when cause has no .code field — must NOT be literal "undefined"
    expect(outputWithError.error?.code).toBeUndefined();
    const leaked = findLeakedErrorAssistant(output.events);
    expect(leaked).toBeUndefined();
  });

  it('signal.aborted → SDKAssistantMessage "[aborted]" preserved (UX path)', async () => {
    // Given: abort signal already aborted before LLM call
    const ac = new AbortController();
    ac.abort();
    const err = new Error("aborted by signal");
    const llm = makeThrowingLlm(err);

    // When
    const output = await runAgentLoop(makeInputs(llm, { signal: ac.signal }));

    // Then: stream has "[aborted]" assistant message (UX-friendly)
    const aborted = output.events.find((e): boolean => {
      if (typeof e !== "object" || e === null) return false;
      const ev = e as { type?: string };
      if (ev.type !== "assistant") return false;
      return JSON.stringify(e).includes("[aborted]");
    });
    expect(aborted, "abort UX message preserved as assistant").toBeDefined();
    // ctx.error must NOT be populated for abort path (D4)
    const outputWithError = output as typeof output & { error?: unknown };
    expect(outputWithError.error).toBeUndefined();
  });

  // v1.1 EC-3-A — first-error-wins (set-once invariant per ADR D3)
  it("multi-turn loop: first error preserved, NOT clobbered by later turn errors", async () => {
    // Given: LLM that throws DIFFERENT errors on each call
    let callCount = 0;
    const llm: LlmClient = {
      name: "two-failure-mock",
      // biome-ignore lint/correctness/useYield: intentional non-yielding generator mock — throws before any chunk to test multi-turn error preservation
      async *stream(): AsyncGenerator<LlmEvent, LlmFinish, void> {
        callCount++;
        if (callCount === 1) {
          throw new AuthenticationError("first-error: auth_failed", {
            code: "first_failure",
          });
        }
        throw new Error("second-error: should-be-ignored");
      },
    };

    // When (single iteration of loop will catch first; second call won't happen
    // in current loop semantics, but the test pins the invariant that IF a
    // second error reached the catch, it would NOT overwrite ctx.error)
    const output = await runAgentLoop(makeInputs(llm));

    // Then: error is from FIRST throw, not second
    const outputWithError = output as typeof output & {
      error?: { message: string; code?: string };
    };
    expect(outputWithError.error?.message).toContain("first-error");
    expect(outputWithError.error?.message).not.toContain("second-error");
    expect(outputWithError.error?.code).toBe("first_failure");
  });

  // Sanity: happy path STILL works (no regression)
  it("sanity: successful LLM call → finalStatus=finished, no error field", async () => {
    const llm = makeTextLlmWithTokens("Hello world");
    const output = await runAgentLoop(makeInputs(llm));
    expect(output.finalStatus).toBe("finished");
    expect(output.result).toBe("Hello world");
    const outputWithError = output as typeof output & { error?: unknown };
    expect(outputWithError.error).toBeUndefined();
  });
});
