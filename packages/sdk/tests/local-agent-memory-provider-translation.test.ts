import { describe, expect, it, vi } from "vitest";

import { LocalAgentMemory } from "../src/internal/local-agent/local-agent-memory.js";
import { createLocalAgentMemoryProvider } from "../src/internal/local-agent/local-agent-memory-provider.js";

/**
 * What the adapter's `runActivePass` actually DOES: translate `args.history` into the
 * `priorMessages` shape `runActiveMemoryIfEnabled` takes, and translate the summary back.
 *
 * Four files and 579 lines existed to license the LocalAgent memory refactor, calling themselves an
 * "equivalence proof ... needed before the actual LocalAgent.send() refactor". None of them enabled
 * memory: with `memory.enabled === false` — the test default — the glue methods are no-ops that
 * return `undefined` and the adapter returns `{ facts: [] }`, and each file says so in its own words.
 * So both sides of every equivalence were the empty case, and the translation the suite is named for
 * was never exercised. Two no-ops agreeing is not an equivalence.
 *
 * The comment in those files identified the missing move: spy the glue method the adapter delegates
 * to and assert what it RECEIVES. That is observable without an IndexManager, without embeddings and
 * without enabling memory — the delegation happens before any of the enabled-path guards.
 */
describe("the memory-provider adapter translates what it passes to the glue", () => {
  function providerWithSpiedGlue(): {
    provider: ReturnType<typeof createLocalAgentMemoryProvider>;
    calls: Array<[string, ReadonlyArray<{ role: string; text: string }>]>;
  } {
    const calls: Array<[string, ReadonlyArray<{ role: string; text: string }>]> = [];
    vi.spyOn(LocalAgentMemory.prototype, "runActiveMemoryIfEnabled").mockImplementation(
      async (userText, priorMessages) => {
        calls.push([userText, priorMessages]);
        return "SUMMARY";
      },
    );
    const provider = createLocalAgentMemoryProvider({
      agentOptions: { apiKey: "sk-ant-test-key", model: { id: "claude-sonnet-4-6" } },
      workspaceCwd: process.cwd(),
      agentId: "translation-fixture",
    } as never);
    return { provider, calls };
  }

  it("maps history { role, content } onto priorMessages { role, text }, in order", async () => {
    const { provider, calls } = providerWithSpiedGlue();
    const handle = await provider.init({} as never);

    await provider.runActivePass?.(handle, {
      userMessage: "what did I say?",
      history: [
        { role: "user", content: "first" },
        { role: "assistant", content: "second" },
      ],
    } as never);

    expect(calls, "the adapter never reached the glue — this test proves nothing").toHaveLength(1);
    const [userText, priorMessages] = calls[0] ?? ["", []];
    expect(userText).toBe("what did I say?");
    expect(
      priorMessages,
      "`content` becomes `text`; the two shapes are why this translation exists",
    ).toEqual([
      { role: "user", text: "first" },
      { role: "assistant", text: "second" },
    ]);

    vi.restoreAllMocks();
  });

  it("carries a non-empty summary back as systemPromptAdditions", async () => {
    const { provider } = providerWithSpiedGlue();
    const handle = await provider.init({} as never);

    const result = await provider.runActivePass?.(handle, {
      userMessage: "hi",
      history: [],
    } as never);

    expect(result).toEqual({ facts: [], systemPromptAdditions: "SUMMARY" });
    vi.restoreAllMocks();
  });

  it("an empty summary produces no systemPromptAdditions at all, not an empty one", async () => {
    vi.spyOn(LocalAgentMemory.prototype, "runActiveMemoryIfEnabled").mockResolvedValue("");
    const provider = createLocalAgentMemoryProvider({
      agentOptions: { apiKey: "sk-ant-test-key", model: { id: "claude-sonnet-4-6" } },
      workspaceCwd: process.cwd(),
      agentId: "translation-fixture-empty",
    } as never);
    const handle = await provider.init({} as never);

    const result = await provider.runActivePass?.(handle, {
      userMessage: "hi",
      history: [],
    } as never);

    // The distinction matters downstream: an absent key means "nothing to add", an empty string
    // would be appended to the system prompt as a blank section.
    expect(result).toEqual({ facts: [] });
    expect(result).not.toHaveProperty("systemPromptAdditions");
    vi.restoreAllMocks();
  });
});

describe("with memory disabled — the default — the adapter is a well-behaved no-op", () => {
  /**
   * The one claim the 579 lines this file replaces were actually making. Three files and sixteen
   * tests asserted it in pieces, calling themselves an equivalence proof: with `memory.enabled`
   * false, the glue returns `undefined` and the adapter returns `{ facts: [] }`. Both sides of every
   * "equivalence" were the empty case, so what they compared was two no-ops agreeing.
   *
   * Measured before deleting them: they survive BOTH mutants the translation cases above kill —
   * mapping `text` from the wrong field, and discarding the summary entirely. They detect nothing
   * about the behaviour they are named for. The no-op path is real and worth one test; it is this
   * one.
   */
  it("returns no facts and no additions, and does not throw", async () => {
    const provider = createLocalAgentMemoryProvider({
      agentOptions: { apiKey: "sk-ant-test-key", model: { id: "claude-sonnet-4-6" } },
      workspaceCwd: process.cwd(),
      agentId: "disabled-fixture",
    } as never);
    const handle = await provider.init({} as never);

    expect(provider.buildTools?.(handle, {} as never)).toEqual([]);
    await expect(
      provider.runActivePass?.(handle, { userMessage: "hi", history: [] } as never),
    ).resolves.toEqual({ facts: [] });
    // `dispose` is SYNCHRONOUS on this adapter (returns void, not a promise) — asserting it with
    // `.resolves` fails with "You must provide a Promise to expect()", which is how that was found.
    expect(() => provider.dispose?.(handle)).not.toThrow();
    await expect(provider.sync?.(handle)).resolves.toBeUndefined();
  });

  it("a handle the adapter did not create is refused, not dereferenced", async () => {
    const provider = createLocalAgentMemoryProvider({
      agentOptions: { apiKey: "sk-ant-test-key", model: { id: "claude-sonnet-4-6" } },
      workspaceCwd: process.cwd(),
      agentId: "foreign-handle-fixture",
    } as never);

    // No internal state on this handle: the guard is what keeps it from throwing on a missing field.
    await expect(
      provider.runActivePass?.(
        { adapter: {} } as never,
        {
          userMessage: "hi",
          history: [],
        } as never,
      ),
    ).resolves.toEqual({ facts: [] });
    expect(provider.buildTools?.({ adapter: {} } as never, {} as never)).toEqual([]);
  });
});
