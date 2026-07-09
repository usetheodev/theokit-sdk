import { describe, expect, it } from "vitest";
import { z } from "zod";

import { generateObjectImpl } from "../../src/generate-object.js";
import type { AgentOptions, SDKAgent } from "../../src/types/agent.js";

/**
 * M21 — `generateObject({ structuringModel })`. When set, `model` reasons in free text (phase 1) and
 * `structuringModel` extracts the object by calling the `output` tool (phase 2). Injected `deps`
 * record the model id of every transient agent created, so we assert two distinct ids in the run.
 */

function modelId(m: unknown): string {
  return typeof m === "object" && m !== null ? String((m as { id: unknown }).id) : String(m);
}

/** A fake `deps.create` that records model ids and, for the structuring agent, fires the output tool. */
function makeDeps(createdModels: string[]) {
  return {
    create: async (opts: AgentOptions): Promise<SDKAgent> => {
      createdModels.push(modelId(opts.model));
      const outputTool = opts.tools?.find((t) => t.name === "output");
      const agent = {
        id: `fake-${createdModels.length}`,
        send: async () => ({
          wait: async () => {
            // Structuring agent (has the output tool): invoke it to capture a schema-valid object.
            // The handler throws the internal capture sentinel — swallow it like the real dispatcher.
            if (outputTool) {
              try {
                await outputTool.handler({ answer: 42 } as never);
              } catch {
                /* CaptureSentinel — capturedRaw is already set by the closure */
              }
            }
            return {
              status: "finished",
              result: "The answer is 42.",
              usage: { inputTokens: 3, outputTokens: 5 },
            };
          },
        }),
        dispose: async () => {},
      };
      return agent as unknown as SDKAgent;
    },
    delete: async () => {},
  };
}

const schema = z.object({ answer: z.number() });

describe("M21 — generateObject structuringModel", () => {
  it("runs reasoning on `model` then structuring on `structuringModel` — two distinct model ids", async () => {
    const createdModels: string[] = [];
    const result = await generateObjectImpl(
      {
        schema,
        prompt: "What is the answer?",
        model: { id: "big-reasoner" },
        structuringModel: { id: "cheap-structurer" },
        local: { cwd: "/tmp" },
      },
      makeDeps(createdModels),
    );

    // Phase 1 used the big model; phase 2 used the cheap structuring model.
    expect(createdModels).toEqual(["big-reasoner", "cheap-structurer"]);
    expect(result.object).toEqual({ answer: 42 });
  });

  it("is single-model (backward-compatible) when structuringModel is absent", async () => {
    const createdModels: string[] = [];
    const result = await generateObjectImpl(
      {
        schema,
        prompt: "What is the answer?",
        model: { id: "solo-model" },
        local: { cwd: "/tmp" },
      },
      makeDeps(createdModels),
    );

    // Exactly one transient agent — today's behavior.
    expect(createdModels).toEqual(["solo-model"]);
    expect(result.object).toEqual({ answer: 42 });
  });
});
