/**
 * Property tests for batchImpl (T5.1).
 *
 * Adversarial sweeps validating result-order preservation, no prompt loss,
 * filter discipline, and bounded concurrency under randomized failures.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { batchImpl } from "../src/batch.js";
import type { TheokitAgentError } from "../src/errors.js";
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

describe("batchImpl properties (T5.1)", () => {
  it("preserves input order under random per-prompt delays", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string({ minLength: 1, maxLength: 6 }), { minLength: 1, maxLength: 10 }),
        fc.integer({ min: 1, max: 4 }),
        async (prompts, concurrency) => {
          const create = buildFakeFactory(async (p) => {
            await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 5)));
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
        fc.array(fc.string({ minLength: 1, maxLength: 4 }), { minLength: 0, maxLength: 8 }),
        fc.integer({ min: 1, max: 4 }),
        async (prompts, concurrency) => {
          const create = buildFakeFactory(async (p) =>
            Math.random() < 0.3 ? new Error("flaky") : { kind: "ok", text: p },
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
        async (prompts) => {
          const failIndex = Math.floor(Math.random() * prompts.length);
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
        fc.array(fc.string({ minLength: 1, maxLength: 4 }), { minLength: 0, maxLength: 6 }),
        async (prompts) => {
          const create = buildFakeFactory(async (p) =>
            Math.random() < 0.5 ? new Error("drop") : { kind: "ok", text: p },
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
        fc.array(fc.string({ minLength: 1, maxLength: 4 }), { minLength: 4, maxLength: 12 }),
        fc.integer({ min: 1, max: 3 }),
        async (prompts, concurrency) => {
          let inFlight = 0;
          let maxInFlight = 0;
          const create = buildFakeFactory(async (p) => {
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 3)));
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
