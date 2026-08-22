import { expect, it, vi } from "vitest";
import { makeLlmFinish } from "../../../src/internal/llm/finish.js";

/*
 * #372 — provider-reported token usage reached `run.usage` and the cost calculation with no bounds
 * check, no sign check and no type check.
 *
 * Measured, four SSE responses differing only in their `usage` object:
 *
 *   -500 / -500 / -1000        → cost  -0.000375
 *   9e15 / 9e15 / 1.8e16       → cost   6750000000  ($6.75bn)
 *   "100" / "50" / "150"       → usage  {"0100", "050", "0100050"}   ← string concatenation
 *   NaN / 1 / NaN              → usage  {0, 1, 1}                    ← already defended
 *
 * That last row is why the others read as gaps rather than as a deliberate "trust the provider"
 * stance. This is also the input that drives `@theokit/sdk-budget`: a negative count moves a
 * budget gate DOWNWARD, and `"0100050"` is not a number in any useful sense.
 *
 * `makeLlmFinish` is the one funnel every transport converges on — openai, anthropic,
 * ollama-native and bedrock all build their finish through it — so the boundary check lives here
 * rather than four times over.
 */

const base = { stopReason: "end_turn" as const, text: "", toolCalls: [] };

it("drops a negative token count instead of billing it", () => {
  const warn = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

  const finish = makeLlmFinish({ ...base, inputTokens: -500, outputTokens: -500 });

  expect(finish.inputTokens).toBeUndefined();
  expect(finish.outputTokens).toBeUndefined();
  expect(warn.mock.calls.map((c) => String(c[0])).join(" ")).toMatch(/usage/i);
  warn.mockRestore();
});

it("parses a numeric string rather than concatenating it", () => {
  const finish = makeLlmFinish({
    ...base,
    inputTokens: "100" as unknown as number,
    outputTokens: "50" as unknown as number,
  });

  expect(finish.inputTokens).toBe(100);
  expect(finish.outputTokens).toBe(50);
});

it("drops values that are not counts at all", () => {
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);

  const finish = makeLlmFinish({
    ...base,
    inputTokens: Number.NaN,
    outputTokens: Number.POSITIVE_INFINITY,
    cacheReadTokens: "not a number" as unknown as number,
    cacheWriteTokens: 12.7,
    reasoningTokens: null as unknown as number,
  });

  expect(finish.inputTokens).toBeUndefined();
  expect(finish.outputTokens).toBeUndefined();
  expect(finish.cacheReadTokens).toBeUndefined();
  expect(finish.cacheWriteTokens).toBe(12); // a fractional count is floored, not discarded
  expect(finish.reasoningTokens).toBeUndefined();
  vi.restoreAllMocks();
});

it("passes ordinary counts through untouched, zero included", () => {
  // The accepted cases (`testing.md` § 4.2). A sanitiser that dropped everything would satisfy the
  // tests above while silently zeroing every bill — and `0` is a real count, not a missing one, so
  // a falsy check here would be its own bug.
  const finish = makeLlmFinish({
    ...base,
    inputTokens: 1200,
    outputTokens: 0,
    cacheReadTokens: 800,
    cacheWriteTokens: 40,
    reasoningTokens: 256,
  });

  expect(finish).toMatchObject({
    inputTokens: 1200,
    outputTokens: 0,
    cacheReadTokens: 800,
    cacheWriteTokens: 40,
    reasoningTokens: 256,
  });
});

it("leaves absent usage absent", () => {
  const finish = makeLlmFinish(base);

  expect(finish.inputTokens).toBeUndefined();
  expect("outputTokens" in finish).toBe(false);
});
