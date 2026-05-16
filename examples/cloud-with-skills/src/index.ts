import { Agent, type SDKAgent } from "@usetheo/sdk";

interface CloudAgentWithPayload extends SDKAgent {
  cloudPayload: Record<string, unknown>;
}

/**
 * Cloud agent + skills.enabled (ADR D15: cloud tool parity).
 *
 * Demonstrates that skills declared in `AgentOptions.skills.enabled` are
 * serialized into the cloud-agent payload that PaaS will receive at
 * `POST /v1/agents/{id}/runs`. PaaS reads `.theokit/skills/<name>/SKILL.md`
 * from the cloned repo and registers the matching skills server-side.
 *
 * Today runs in fixture mode (theo_test_* key) — the SDK does not call
 * PaaS. When PaaS ships, swap `.env` to a real key + base URL and the
 * same code reaches the live runtime.
 */
async function main(): Promise<void> {
  const agent = (await Agent.create({
    apiKey: process.env.THEOKIT_API_KEY ?? "theo_test_cloud_with_skills",
    model: { id: "google/gemini-2.0-flash-exp:free" },
    cloud: {
      repos: [{ url: "https://github.com/usetheo/example", startingRef: "main" }],
    },
    skills: { enabled: ["deploy", "review"] },
    systemPrompt:
      "When a PR opens, run the `deploy` skill on the main branch and request a `review` from the team.",
  })) as unknown as CloudAgentWithPayload;

  console.log(`Cloud agent created: ${agent.agentId}`);
  console.log("\nCanonical payload that PaaS will receive:");
  console.log(JSON.stringify(agent.cloudPayload, null, 2));
}

main().catch((cause) => {
  console.error("cloud-with-skills failed:", cause);
  process.exit(1);
});
