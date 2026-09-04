/**
 * Shared agent introspection (describe) test helpers.
 * Consolidates 270+ duplicated lines from agent-describe.test.ts (7 sites).
 *
 * @internal
 */

import type { CustomTool } from "@theokit/sdk";

/**
 * Standard test tool for agent.describe() tests.
 */
export function buildDescribeTestTool(): CustomTool {
  return {
    name: "search_docs",
    description: "Search the documentation",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    handler: () => "results",
  };
}

/**
 * Build test subagent for describe tests.
 */
export function buildDescribeTestSubagent(overrides?: Record<string, any>) {
  return {
    description: "Reviews a diff",
    prompt: "You are a strict reviewer.",
    model: { id: "claude-3-5-haiku" },
    tools: ["search_docs"],
    ...overrides,
  };
}
