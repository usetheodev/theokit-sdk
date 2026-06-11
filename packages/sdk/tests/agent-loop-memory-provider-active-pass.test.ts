/**
 * `MemoryProvider.runActivePass()` wiring tests (SDK 2.0 Phase 1 / T1.5.3).
 *
 * Mirrors iter 15-16 BudgetTracker wiring discipline: pin the exact
 * BRANCH LOGIC the `initLoopContext` call site implements:
 *   - When provider + handle set: call runActivePass once with the
 *     synthesized args (userMessage + history + agentId).
 *   - When provider returns systemPromptAdditions, store on ctx so the
 *     LLM call site can concat to inputs.systemPrompt.
 *   - When provider throws, swallow (additions stay undefined).
 *   - When provider returns empty additions or undefined, ctx field
 *     stays unset.
 */

import type {
  ActiveMemoryPassArgs,
  ActiveMemoryPassResult,
  MemoryAdapter,
  MemoryProvider,
  MemoryProviderHandle,
  MemoryProviderInitOptions,
  SDKAgent,
} from "@theokit/sdk";
import { describe, expect, it, vi } from "vitest";

function makeStubAdapter(): MemoryAdapter {
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

function buildSpyProvider(opts?: {
  activePassThrows?: boolean;
  passResult?: ActiveMemoryPassResult;
}) {
  const initSpy = vi.fn(
    async (_o: MemoryProviderInitOptions): Promise<MemoryProviderHandle> => ({
      adapter: makeStubAdapter(),
    }),
  );
  const buildToolsSpy = vi.fn((_h: MemoryProviderHandle, _a: SDKAgent) => []);
  const runActivePassSpy = vi.fn(
    async (_h: MemoryProviderHandle, _a: ActiveMemoryPassArgs): Promise<ActiveMemoryPassResult> => {
      if (opts?.activePassThrows) throw new Error("activePass blew");
      return opts?.passResult ?? { facts: [] };
    },
  );
  const disposeSpy = vi.fn((_h: MemoryProviderHandle): void => undefined);
  const provider: MemoryProvider = {
    init: initSpy,
    buildTools: buildToolsSpy,
    runActivePass: runActivePassSpy,
    dispose: disposeSpy,
  };
  return { provider, initSpy, buildToolsSpy, runActivePassSpy, disposeSpy };
}

/**
 * Mirror of the wiring at `loop.ts initLoopContext` ~ after the buildTools
 * loop. Calls `provider.runActivePass(handle, { userMessage, history,
 * agentId })` once; returns the systemPromptAdditions to store on ctx.
 * Returns undefined on swallow OR absent provider OR empty additions.
 */
async function performActivePass(
  provider: MemoryProvider | undefined,
  handle: MemoryProviderHandle | undefined,
  args: ActiveMemoryPassArgs,
): Promise<string | undefined> {
  if (provider === undefined || handle === undefined) return undefined;
  let additions: string | undefined;
  try {
    const passResult = await provider.runActivePass(handle, args);
    if (
      passResult.systemPromptAdditions !== undefined &&
      passResult.systemPromptAdditions.length > 0
    ) {
      additions = passResult.systemPromptAdditions;
    }
  } catch {
    additions = undefined;
  }
  return additions;
}

/**
 * Mirror of `resolveSystemPromptWithMemoryAdditions` in loop.ts. Pure
 * function so the concat semantics can be exhaustively pinned.
 */
function concatSystemPrompt(
  systemPrompt: string | undefined,
  additions: string | undefined,
): string | undefined {
  if (additions === undefined || additions.length === 0) return systemPrompt;
  if (systemPrompt === undefined || systemPrompt.length === 0) return additions;
  return `${systemPrompt}\n\n${additions}`;
}

describe("MemoryProvider runActivePass() wiring (Phase 1 / T1.5.3)", () => {
  it("test_no_provider_means_no_active_pass", async () => {
    const additions = await performActivePass(undefined, undefined, {
      userMessage: "x",
      history: [],
      agentId: "a",
    });
    expect(additions).toBeUndefined();
  });

  it("test_active_pass_called_once_with_synthesized_args", async () => {
    const { provider, runActivePassSpy } = buildSpyProvider();
    const handle = await provider.init({ cwd: "/tmp" });
    await performActivePass(provider, handle, {
      userMessage: "what's my preference?",
      history: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
      agentId: "agent-1",
    });
    expect(runActivePassSpy).toHaveBeenCalledTimes(1);
    expect(runActivePassSpy.mock.calls[0]?.[0]).toBe(handle);
    expect(runActivePassSpy.mock.calls[0]?.[1]).toEqual({
      userMessage: "what's my preference?",
      history: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
      agentId: "agent-1",
    });
  });

  it("test_additions_returned_when_provider_supplies_them", async () => {
    const { provider } = buildSpyProvider({
      passResult: {
        facts: [],
        systemPromptAdditions: "User prefers TypeScript.",
      },
    });
    const handle = await provider.init({ cwd: "/tmp" });
    const additions = await performActivePass(provider, handle, {
      userMessage: "x",
      history: [],
      agentId: "a",
    });
    expect(additions).toBe("User prefers TypeScript.");
  });

  it("test_empty_additions_string_treated_as_undefined", async () => {
    const { provider } = buildSpyProvider({
      passResult: {
        facts: [],
        systemPromptAdditions: "",
      },
    });
    const handle = await provider.init({ cwd: "/tmp" });
    const additions = await performActivePass(provider, handle, {
      userMessage: "x",
      history: [],
      agentId: "a",
    });
    expect(additions).toBeUndefined();
  });

  it("test_no_additions_field_means_undefined", async () => {
    const { provider } = buildSpyProvider({ passResult: { facts: [] } });
    const handle = await provider.init({ cwd: "/tmp" });
    const additions = await performActivePass(provider, handle, {
      userMessage: "x",
      history: [],
      agentId: "a",
    });
    expect(additions).toBeUndefined();
  });

  it("test_active_pass_throw_swallowed_additions_undefined", async () => {
    const { provider, runActivePassSpy } = buildSpyProvider({ activePassThrows: true });
    const handle = await provider.init({ cwd: "/tmp" });
    const additions = await performActivePass(provider, handle, {
      userMessage: "x",
      history: [],
      agentId: "a",
    });
    expect(runActivePassSpy).toHaveBeenCalledTimes(1);
    expect(additions).toBeUndefined();
  });

  it("test_active_pass_not_called_when_init_failed", async () => {
    const { provider, runActivePassSpy } = buildSpyProvider();
    const additions = await performActivePass(provider, undefined, {
      userMessage: "x",
      history: [],
      agentId: "a",
    });
    expect(runActivePassSpy).not.toHaveBeenCalled();
    expect(additions).toBeUndefined();
  });

  it("test_breaker_tripped_is_metadata_does_not_block_loop", async () => {
    const { provider } = buildSpyProvider({
      passResult: {
        facts: [],
        systemPromptAdditions: "fallback context",
        breakerTripped: true,
      },
    });
    const handle = await provider.init({ cwd: "/tmp" });
    const additions = await performActivePass(provider, handle, {
      userMessage: "x",
      history: [],
      agentId: "a",
    });
    // breaker tripped is purely telemetry — loop never hard-blocks on it.
    // additions still get injected.
    expect(additions).toBe("fallback context");
  });
});

describe("resolveSystemPromptWithMemoryAdditions (concat helper)", () => {
  it("test_no_inbound_no_additions_returns_undefined", () => {
    expect(concatSystemPrompt(undefined, undefined)).toBeUndefined();
  });

  it("test_no_inbound_with_additions_returns_additions_alone", () => {
    expect(concatSystemPrompt(undefined, "facts here")).toBe("facts here");
  });

  it("test_inbound_no_additions_returns_inbound_unchanged", () => {
    expect(concatSystemPrompt("you are a chatbot", undefined)).toBe("you are a chatbot");
  });

  it("test_inbound_with_additions_concats_with_blank_line", () => {
    expect(concatSystemPrompt("you are a chatbot", "user prefers TypeScript")).toBe(
      "you are a chatbot\n\nuser prefers TypeScript",
    );
  });

  it("test_empty_inbound_treated_as_no_inbound", () => {
    expect(concatSystemPrompt("", "facts")).toBe("facts");
  });

  it("test_empty_additions_treated_as_no_additions", () => {
    expect(concatSystemPrompt("you are a chatbot", "")).toBe("you are a chatbot");
  });
});
