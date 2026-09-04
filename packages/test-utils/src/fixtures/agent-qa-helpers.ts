/**
 * Shared agent QA test fixtures.
 * Consolidates 417+ duplicated lines from suite-agent-qa-fixture.test.ts (4 sites).
 * Provides QA scenario builders and test agents.
 *
 * @internal
 */

/**
 * Build a QA test agent with common configuration.
 * Consolidates repeated Agent.create() patterns.
 */
export function buildQAAgent(overrides?: Partial<Record<string, unknown>>): any {
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
export function buildQAScenario(overrides?: Partial<Record<string, unknown>>) {
  return {
    name: "qa-scenario",
    description: "QA test scenario",
    steps: [],
    expectedOutcome: "success",
    ...overrides,
  };
}
