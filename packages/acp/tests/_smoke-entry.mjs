import { Agent } from "@theokit/sdk";

export default async (sessionId) => {
  return Agent.create({
    apiKey: "theo_test_acp_smoke",
    model: { id: "openai/gpt-4o-mini" },
    local: { cwd: "/tmp/acp-smoke-Wld8M7" },
    name: `acp-smoke-${sessionId}`,
  });
};
