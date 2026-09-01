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

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ActiveMemoryPassArgs,
  ActiveMemoryPassResult,
  MemoryProvider,
  MemoryProviderHandle,
  MemoryProviderInitOptions,
  SDKAgent,
} from "@theokit/sdk";
import { afterAll, describe, expect, it, vi } from "vitest";
import { resolveSystemPromptWithMemoryAdditions } from "../../src/internal/agent-loop/loop-llm-stream.js";
import { driveLoop } from "../helpers/agent-loop-driver.js";
import { stubMemoryAdapter } from "../helpers/memory-stubs.js";
import { removeTempDirRobustSync } from "../helpers/temp-workspace.js";

const CWD = mkdtempSync(join(tmpdir(), "theokit-activepass-"));
afterAll(() => {
  removeTempDirRobustSync(CWD);
});

function buildSpyProvider(opts?: {
  activePassThrows?: boolean;
  passResult?: ActiveMemoryPassResult;
}) {
  const initSpy = vi.fn(
    async (_o: MemoryProviderInitOptions): Promise<MemoryProviderHandle> => ({
      adapter: stubMemoryAdapter(),
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
 * The concat cases below call the PRODUCTION `resolveSystemPromptWithMemoryAdditions` directly.
 *
 * They used to call a local `concatSystemPrompt` whose docblock said it was a "Mirror of
 * `resolveSystemPromptWithMemoryAdditions` in loop.ts". The function it mirrored is exported from
 * `loop-llm-stream.ts` and always was, so the copy bought nothing and could drift silently — the
 * shape `agent-loop/budget-tracker-check-wiring.test.ts` reached, where a mirror ended up pinning
 * the opposite of production while the suite stayed green.
 */
describe("MemoryProvider runActivePass(), observed in what the model was asked", () => {
  it("test_no_provider_means_no_active_pass", async () => {
    const { requests } = await driveLoop(CWD, { systemPrompt: "base" });
    expect(requests[0]?.system).toBe("base");
  });

  it("test_active_pass_called_once_with_the_handle_init_returned", async () => {
    const { provider, runActivePassSpy, initSpy } = buildSpyProvider();
    await driveLoop(CWD, { memoryProvider: provider, userMessage: "what's my preference?" });

    expect(runActivePassSpy).toHaveBeenCalledTimes(1);
    const handle = await initSpy.mock.results[0]?.value;
    // Identity, not equality — the loop threads the handle through rather than rebuilding it.
    expect(runActivePassSpy.mock.calls[0]?.[0]).toBe(handle);
    expect(runActivePassSpy.mock.calls[0]?.[1]?.userMessage).toBe("what's my preference?");
  });

  it("test_additions_reach_the_system_prompt", async () => {
    const { provider } = buildSpyProvider({
      passResult: { facts: [], systemPromptAdditions: "User prefers TypeScript." },
    });
    const { requests } = await driveLoop(CWD, { memoryProvider: provider, systemPrompt: "base" });
    expect(String(requests[0]?.system)).toContain("User prefers TypeScript.");
    expect(String(requests[0]?.system)).toContain("base");
  });

  it("test_empty_additions_string_changes_nothing", async () => {
    const { provider } = buildSpyProvider({
      passResult: { facts: [], systemPromptAdditions: "" },
    });
    const { requests } = await driveLoop(CWD, { memoryProvider: provider, systemPrompt: "base" });
    expect(requests[0]?.system).toBe("base");
  });

  it("test_no_additions_field_changes_nothing", async () => {
    const { provider } = buildSpyProvider({ passResult: { facts: [] } });
    const { requests } = await driveLoop(CWD, { memoryProvider: provider, systemPrompt: "base" });
    expect(requests[0]?.system).toBe("base");
  });

  it("test_active_pass_throw_is_swallowed_and_the_turn_still_runs", async () => {
    const { provider, runActivePassSpy } = buildSpyProvider({ activePassThrows: true });
    const { requests, result } = await driveLoop(CWD, {
      memoryProvider: provider,
      systemPrompt: "base",
    });
    expect(runActivePassSpy).toHaveBeenCalledTimes(1);
    expect(requests[0]?.system, "a failed pass must not corrupt the prompt").toBe("base");
    expect(result, "and must not abort the turn").toBeDefined();
  });
});

describe("resolveSystemPromptWithMemoryAdditions (concat helper)", () => {
  it("test_no_inbound_no_additions_returns_undefined", () => {
    expect(resolveSystemPromptWithMemoryAdditions(undefined, undefined)).toBeUndefined();
  });

  it("test_no_inbound_with_additions_returns_additions_alone", () => {
    expect(resolveSystemPromptWithMemoryAdditions(undefined, "facts here")).toBe("facts here");
  });

  it("test_inbound_no_additions_returns_inbound_unchanged", () => {
    expect(resolveSystemPromptWithMemoryAdditions("you are a chatbot", undefined)).toBe(
      "you are a chatbot",
    );
  });

  it("test_inbound_with_additions_concats_with_blank_line", () => {
    expect(
      resolveSystemPromptWithMemoryAdditions("you are a chatbot", "user prefers TypeScript"),
    ).toBe("you are a chatbot\n\nuser prefers TypeScript");
  });

  it("test_empty_inbound_treated_as_no_inbound", () => {
    expect(resolveSystemPromptWithMemoryAdditions("", "facts")).toBe("facts");
  });

  it("test_empty_additions_treated_as_no_additions", () => {
    expect(resolveSystemPromptWithMemoryAdditions("you are a chatbot", "")).toBe(
      "you are a chatbot",
    );
  });
});
