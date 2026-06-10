/**
 * Subagent delegation — declarative child agent invocable as a tool.
 *
 * Per ADR D2: `defineSubAgent(spec)` returns a `CustomTool` that, when
 * invoked by the LLM, creates a child agent and sends the input as a
 * message. EC-2: delegation depth tracked to prevent infinite recursion.
 *
 * @public
 */

import { z } from "zod";

import type { CustomTool } from "../types/agent.js";

export interface SubAgentSpec {
  name: string;
  description: string;
  instructions: string;
  model?: string;
  tools?: CustomTool[];
  maxDelegationDepth?: number;
}

export class MaxDelegationDepthError extends Error {
  readonly code = "max_delegation_depth" as const;
  constructor(
    public readonly currentDepth: number,
    public readonly maxDepth: number,
  ) {
    super(`Max delegation depth ${maxDepth} exceeded (current: ${currentDepth})`);
    this.name = "MaxDelegationDepthError";
  }
}

export function defineSubAgent(spec: SubAgentSpec, _parentDepth = 0): CustomTool {
  const currentDepth = _parentDepth + 1;
  const maxDepth = spec.maxDelegationDepth ?? 3;

  if (currentDepth > maxDepth) {
    throw new MaxDelegationDepthError(currentDepth, maxDepth);
  }

  const inputSchema = z.object({
    input: z.string().describe("Task for the subagent"),
  });

  return {
    name: spec.name,
    description: spec.description,
    inputSchema: inputSchema as unknown as Record<string, unknown>,
    handler: async (rawInput: Record<string, unknown>): Promise<string> => {
      const { input } = inputSchema.parse(rawInput);
      // Lazy import to avoid circular dependency
      const { Agent } = await import("../agent.js");
      const agent = await Agent.create({
        ...(spec.model ? { model: { id: spec.model } } : {}),
        systemPrompt: spec.instructions,
        tools: spec.tools ?? [],
      });
      try {
        const run = await agent.send(input);
        const result = await run.wait();
        return result.result ?? "(no response)";
      } finally {
        agent.dispose();
      }
    },
  };
}
