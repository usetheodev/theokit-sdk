import { describe, expect, it } from "vitest";

import { buildRealRunOptions } from "../../../src/internal/local-agent/local-agent-dispatch.js";

/**
 * Regression: file-based subagents (`.theokit/agents/*.md`) are loaded into
 * `resolvedSubagents`, but the REAL LLM run path used to drop them — only the
 * fixture path forwarded them. So `.theokit/agents/*.md` never became delegation
 * tools against a live model (the model fell back to `shell`). This locks the
 * wiring at the dispatch boundary so the real path receives them too.
 */
describe("buildRealRunOptions — file-based subagents reach the real run", () => {
  it("threads resolvedSubagents into the real-run options", () => {
    const resolvedSubagents = {
      "fact-checker": { description: "Verifies a claim.", prompt: "Answer yes or no." },
    };

    const built = buildRealRunOptions({
      inputs: {
        agentId: "agent-x",
        model: { id: "openai/gpt-4o-mini" },
        options: { apiKey: "sk-real", model: { id: "openai/gpt-4o-mini" } },
        workspaceCwd: "/tmp/x",
        hooksExecutor: {} as never,
        pluginManager: {} as never,
        resolvedSubagents,
        settingSourcesIncludeProject: true,
      } as never,
      message: "hi",
      options: {},
      systemPrompt: undefined,
      priorMessages: [],
      memoryTools: undefined,
    });

    expect(built.subagents).toEqual(resolvedSubagents);
  });
});
