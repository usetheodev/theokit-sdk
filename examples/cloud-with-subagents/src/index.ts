import { Agent, type SDKAgent } from "@usetheo/sdk";

interface CloudAgentWithPayload extends SDKAgent {
  cloudPayload: { agents?: Record<string, { description?: string }> } & Record<string, unknown>;
}

/**
 * Cloud agent + subagents (ADR D15).
 *
 * Subagents are pure declarative config — they serialize cleanly to JSON
 * and PaaS reconstructs them server-side from the cloud-agent payload.
 */
async function main(): Promise<void> {
  const agent = (await Agent.create({
    apiKey: process.env.THEOKIT_API_KEY ?? "theo_test_cloud_with_subagents",
    model: { id: "google/gemini-2.0-flash-001" },
    cloud: {
      repos: [{ url: "https://github.com/usetheo/example", startingRef: "main" }],
    },
    agents: {
      reviewer: {
        description: "Reviews pull requests for security issues",
        prompt: "You are a security-focused code reviewer. Look for SQL injection, XSS, secret leaks.",
        model: { id: "google/gemini-2.0-flash-001" },
      },
      tester: {
        description: "Generates test cases for changed code",
        prompt: "You are a TDD specialist. Write failing tests FIRST, then implementation.",
      },
    },
  })) as unknown as CloudAgentWithPayload;

  console.log(`Cloud agent created: ${agent.agentId}`);
  console.log("\nCanonical payload that PaaS will receive:");
  console.log(JSON.stringify(agent.cloudPayload, null, 2));

  console.log("\nSubagents in the payload:");
  if (agent.cloudPayload.agents !== undefined) {
    for (const [name, ref] of Object.entries(agent.cloudPayload.agents)) {
      console.log(`  - ${name}: ${ref.description ?? "(no description)"}`);
    }
  }
}

main().catch((cause) => {
  console.error("cloud-with-subagents failed:", cause);
  process.exit(1);
});
