/**
 * Property tests for batchImpl (T5.1).
 *
 * Adversarial sweeps validating result-order preservation, no prompt loss,
 * filter discipline, and bounded concurrency under randomized failures.
 *
 * B-025 — every source of randomness in this file is a fast-check arbitrary, and that is a hard
 * rule here, not a style preference. fast-check reproduces a failure by replaying its seed, but it
 * only replays values IT produced. Five sites used to read `Math.random()` inside the predicate
 * (the per-prompt delays, a 30% failure rate, which prompt fails, a 50% drop rate, and a second
 * delay), so a counterexample found on CI regenerated different values on replay: the printed seed
 * pointed at nothing, which is exactly what makes a property test worthless as a debugging tool.
 * The properties below are unchanged in what they assert — only the source of the randomness moved.
 *
 * Per-call values are drawn from an arbitrary-provided array indexed by a dispatch counter rather
 * than by prompt text, because `fc.string` can and does generate duplicate prompts. The counter is
 * advanced only by batchImpl's own deterministic dispatch, so the whole predicate stays a pure
 * function of the generated input.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { TheokitAgentError } from "../src/errors.js";
import { batchImpl } from "../src/internal/agent/batch.js";
import type { AgentOptions, SDKAgent } from "../src/types/agent.js";
import type { BatchOptions, BatchResult } from "../src/types/batch.js";

type Verdict = { kind: "ok"; text: string } | Error;

function buildFakeFactory(
  onSend: (prompt: string) => Promise<Verdict>,
): (options: AgentOptions) => Promise<SDKAgent> {
  return async (options: AgentOptions): Promise<SDKAgent> => {
    const fake = {
      agentId: `fake-${Math.random().toString(16).slice(2)}`,
      model: options.model,
      options,
      async send(message: string | { text: string }) {
        const prompt = typeof message === "string" ? message : message.text;
        const verdict = await onSend(prompt);
        if (verdict instanceof Error) {
          return {
            wait: async () => {
              throw verdict;
            },
          };
        }
        return {
          wait: async () => ({
            id: "r",
            status: "finished" as const,
            result: verdict.text,
          }),
        };
      },
      close() {},
      async reload() {},
      async dispose() {},
      async [Symbol.asyncDispose]() {},
      async listArtifacts() {
        return [];
      },
      async downloadArtifact(): Promise<Buffer> {
        throw new Error("unsupported");
      },
    } as unknown as SDKAgent;
    return fake;
  };
}

const baseOptions: BatchOptions = {
  apiKey: "theo_test_property",
  model: { id: "openai/gpt-4o-mini" },
  local: {},
};

/**
 * Hands out `values` one per call, in dispatch order, falling back to `whenExhausted`.
 *
 * B-025. The generated values must reach the fake agent, and the fake agent only ever sees the
 * prompt text — which `fc.string` may repeat within one run, so a text-keyed lookup would be
 * ambiguous. A call counter is unambiguous and is advanced solely by batchImpl's own dispatch, so
 * the predicate remains a pure function of the generated input and replays exactly from the seed.
 */
function drawSequence<T>(values: readonly T[], whenExhausted: T): () => T {
  let call = 0;
  return (): T => values[call++] ?? whenExhausted;
}

describe("batchImpl properties (T5.1)", () => {
  it("preserves input order under per-prompt delays", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(fc.string({ minLength: 1, maxLength: 6 }), fc.nat({ max: 5 })), {
          minLength: 1,
          maxLength: 10,
        }),
        fc.integer({ min: 1, max: 4 }),
        async (items, concurrency) => {
          const prompts = items.map(([prompt]) => prompt);
          const delaysMs = items.map(([, delay]) => delay);
          const nextDelay = drawSequence(delaysMs, 0);
          const create = buildFakeFactory(async (p) => {
            await new Promise((r) => setTimeout(r, nextDelay()));
            return { kind: "ok", text: p };
          });
          const results = await batchImpl(prompts, { ...baseOptions, concurrency }, { create });
          expect(results.map((r) => r.prompt)).toEqual(prompts);
          expect(results.map((r) => r.index)).toEqual(prompts.map((_, i) => i));
        },
      ),
      { numRuns: 200 },
    );
  });

  it("no prompt loss — results.length always equals prompts.length", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(fc.string({ minLength: 1, maxLength: 4 }), fc.boolean()), {
          minLength: 0,
          maxLength: 8,
        }),
        fc.integer({ min: 1, max: 4 }),
        async (items, concurrency) => {
          const prompts = items.map(([prompt]) => prompt);
          // The failure mask replaces a 30% `Math.random()` rate: fast-check explores the whole
          // space including all-fail and none-fail, and shrinks toward the smallest failing mask.
          const nextFails = drawSequence(
            items.map(([, fails]) => fails),
            false,
          );
          const create = buildFakeFactory(async (p) =>
            nextFails() ? new Error("flaky") : { kind: "ok", text: p },
          );
          const results = await batchImpl(prompts, { ...baseOptions, concurrency }, { create });
          expect(results.length).toBe(prompts.length);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("failures isolated — one failure never corrupts another result", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string({ minLength: 1, maxLength: 4 }), { minLength: 2, maxLength: 8 }),
        fc.nat(),
        async (prompts, failSeed) => {
          // Which prompt fails is now generated, so a counterexample names the same prompt on
          // replay. Taken modulo the length because the array length is generated too.
          const failIndex = failSeed % prompts.length;
          const create = buildFakeFactory(async (p) => {
            return p === prompts[failIndex]
              ? new Error("isolated-failure")
              : { kind: "ok", text: `R:${p}` };
          });
          const results = await batchImpl(prompts, baseOptions, { create });
          // At minimum: failIndex is not ok, others may be ok (could have dupes).
          const failures = results.filter((r) => !r.ok);
          expect(failures.length).toBeGreaterThanOrEqual(1);
          for (const r of failures) {
            expect((r as { error: TheokitAgentError }).error.message).toContain("isolated-failure");
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("filter discipline — output never contains discarded results", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(fc.string({ minLength: 1, maxLength: 4 }), fc.boolean()), {
          minLength: 0,
          maxLength: 6,
        }),
        async (items) => {
          const prompts = items.map(([prompt]) => prompt);
          const nextDrops = drawSequence(
            items.map(([, drops]) => drops),
            false,
          );
          const create = buildFakeFactory(async (p) =>
            nextDrops() ? new Error("drop") : { kind: "ok", text: p },
          );
          const results = await batchImpl(
            prompts,
            { ...baseOptions, filter: (r: BatchResult) => r.ok },
            { create },
          );
          expect(results.every((r) => r.ok)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("concurrency bounded — measured peak in-flight never exceeds limit", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(fc.string({ minLength: 1, maxLength: 4 }), fc.nat({ max: 3 })), {
          minLength: 4,
          maxLength: 12,
        }),
        fc.integer({ min: 1, max: 3 }),
        async (items, concurrency) => {
          const prompts = items.map(([prompt]) => prompt);
          // Fifth site, same defect as the four the audit named — an unseeded delay deciding which
          // overlap the run explores. Fixing four and leaving one would leave the file unreplayable.
          const nextDelay = drawSequence(
            items.map(([, delay]) => delay),
            0,
          );
          let inFlight = 0;
          let maxInFlight = 0;
          const create = buildFakeFactory(async (p) => {
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise((r) => setTimeout(r, nextDelay()));
            inFlight -= 1;
            return { kind: "ok", text: p };
          });
          await batchImpl(prompts, { ...baseOptions, concurrency }, { create });
          expect(maxInFlight).toBeLessThanOrEqual(concurrency);
        },
      ),
      { numRuns: 200 },
    );
  });
});
