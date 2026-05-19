/**
 * Tests for judgeCall + composeJudgePrompt (T2.2, ADRs D119-D121).
 *
 * No real LLM here — the auxiliary `Agent.create` is faked via the
 * injected `deps.create` to verify wiring, env discovery (EC-A),
 * dispose lifecycle, and prompt composition.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { composeJudgePrompt, judgeCallImpl } from "../../../src/internal/judge/judge-call.js";
import type { AgentOptions, SDKAgent } from "../../../src/types/agent.js";

function buildFakeJudgeAgent(
  options: AgentOptions,
  responseText: string,
  onDispose?: () => void,
): SDKAgent {
  const agent = {
    agentId: "judge-fake",
    model: options.model,
    options,
    async send() {
      return {
        wait: async () => ({ result: responseText }),
      };
    },
    close() {},
    async reload() {},
    async dispose() {
      onDispose?.();
    },
    async [Symbol.asyncDispose]() {
      onDispose?.();
    },
    async listArtifacts() {
      return [];
    },
    async downloadArtifact(): Promise<Buffer> {
      throw new Error("not supported");
    },
  } as unknown as SDKAgent;
  return agent;
}

const ORIG_ENV = process.env.OPENROUTER_API_KEY;
beforeEach(() => {
  delete process.env.OPENROUTER_API_KEY;
});
afterEach(() => {
  if (ORIG_ENV === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = ORIG_ENV;
});

describe("judgeCallImpl (T2.2)", () => {
  it("returns done verdict when response starts with DONE:", async () => {
    process.env.OPENROUTER_API_KEY = "k1";
    let createdOptions: AgentOptions | undefined;
    const result = await judgeCallImpl({ goal: "test", lastResponse: "ok" }, undefined, {
      create: async (opts) => {
        createdOptions = opts;
        return buildFakeJudgeAgent(opts, "DONE: tests pass");
      },
    });
    expect(result.verdict).toBe("done");
    expect(result.parseFailed).toBe(false);
    expect(createdOptions?.tools).toEqual([]);
    expect(createdOptions?.model?.id).toBe("openai/gpt-4o-mini");
  });

  it("uses options.judgeModel override", async () => {
    process.env.OPENROUTER_API_KEY = "k1";
    let createdModel: string | undefined;
    await judgeCallImpl(
      { goal: "g", lastResponse: "r" },
      { judgeModel: "anthropic/claude-haiku-3-5" },
      {
        create: async (opts) => {
          createdModel = opts.model?.id;
          return buildFakeJudgeAgent(opts, "CONTINUE: more work");
        },
      },
    );
    expect(createdModel).toBe("anthropic/claude-haiku-3-5");
  });

  // EC-A: no env key + no override → fail-safe (no throw)
  it("returns fail-safe continue when no OPENROUTER_API_KEY and no override", async () => {
    const result = await judgeCallImpl({ goal: "g", lastResponse: "r" }, undefined, {
      create: async () => {
        throw new Error("should not be called");
      },
    });
    expect(result.parseFailed).toBe(true);
    expect(result.verdict).toBe("continue");
    expect(result.reason).toContain("OPENROUTER_API_KEY");
  });

  it("uses explicit options.apiKey when env missing", async () => {
    let createdApiKey: string | undefined;
    await judgeCallImpl(
      { goal: "g", lastResponse: "r" },
      { apiKey: "override-key" },
      {
        create: async (opts) => {
          createdApiKey = opts.apiKey;
          return buildFakeJudgeAgent(opts, "DONE: ok");
        },
      },
    );
    expect(createdApiKey).toBe("override-key");
  });

  it("disposes the auxiliary judge agent on success", async () => {
    process.env.OPENROUTER_API_KEY = "k1";
    let disposed = false;
    await judgeCallImpl({ goal: "g", lastResponse: "r" }, undefined, {
      create: async (opts) =>
        buildFakeJudgeAgent(opts, "DONE: ok", () => {
          disposed = true;
        }),
    });
    expect(disposed).toBe(true);
  });

  it("returns fail-safe on auxiliary send error", async () => {
    process.env.OPENROUTER_API_KEY = "k1";
    const result = await judgeCallImpl({ goal: "g", lastResponse: "r" }, undefined, {
      create: async () => {
        const fake = buildFakeJudgeAgent({ apiKey: "k" } as AgentOptions, "ignored");
        // override .send to throw
        fake.send = async () => {
          throw new Error("network down");
        };
        return fake;
      },
    });
    expect(result.parseFailed).toBe(true);
    expect(result.reason).toContain("judge call failed");
  });

  it("tags fork origin = 'judge' for memory provenance", async () => {
    process.env.OPENROUTER_API_KEY = "k1";
    let captured: AgentOptions | undefined;
    await judgeCallImpl({ goal: "g", lastResponse: "r" }, undefined, {
      create: async (opts) => {
        captured = opts;
        return buildFakeJudgeAgent(opts, "DONE: ok");
      },
    });
    expect((captured?.metadata as { forkOrigin?: string } | undefined)?.forkOrigin).toBe("judge");
  });
});

describe("composeJudgePrompt (T2.2)", () => {
  it("includes goal, subgoals and lastResponse", () => {
    const prompt = composeJudgePrompt({
      goal: "ship the feature",
      lastResponse: "I added tests",
      subgoals: ["write tests", "update docs"],
    });
    expect(prompt).toContain("ship the feature");
    expect(prompt).toContain("write tests, update docs");
    expect(prompt).toContain("I added tests");
    expect(prompt).toContain("DONE:");
    expect(prompt).toContain("CONTINUE:");
    expect(prompt).toContain("SKIPPED:");
  });

  it("falls back to (none) when no subgoals", () => {
    const prompt = composeJudgePrompt({ goal: "g", lastResponse: "r" });
    expect(prompt).toContain("Subgoals: (none)");
  });

  it("falls back to (none) when subgoals is empty array", () => {
    const prompt = composeJudgePrompt({ goal: "g", lastResponse: "r", subgoals: [] });
    expect(prompt).toContain("Subgoals: (none)");
  });
});
