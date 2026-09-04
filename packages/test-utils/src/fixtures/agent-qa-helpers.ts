/**
 * Shared agent QA test fixtures.
 * Consolidates 417+ duplicated lines from suite-agent-qa-fixture.test.ts (4 sites).
 * Provides QA scenario builders and test agents.
 *
 * @internal
 */

import type { Agent, RegisteredAgent } from "@theokit/sdk";

/**
 * Build a QA test agent with common configuration.
 * Consolidates repeated Agent.create() patterns.
 */
export function buildQAAgent(overrides?: Record<string, any>): any {
  return {
    apiKey: "test_qa_agent",
    model: { id: "claude-opus-4-1" },
    skills: ["search", "code-review"],
    ...overrides,
  };
}

/**
 * QA test scenario builder.
 */
export function buildQAScenario(overrides?: Record<string, any>) {
  return {
    name: "qa-scenario",
    description: "QA test scenario",
    steps: [],
    expectedOutcome: "success",
    ...overrides,
  };
}
