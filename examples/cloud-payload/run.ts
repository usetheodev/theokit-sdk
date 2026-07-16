/**
 * Cloud (pre-release) — inspect the redacted per-agent cloud payload the SDK would send to Theo PaaS.
 * Deterministic: passing `cloud: {}` builds a cloud agent whose `cloudPayload` is serialized locally
 * (no network). The runtime is pre-release, but the contract is inspectable today.
 */
import { Agent } from "@theokit/sdk";

const agent = await Agent.create({
  apiKey: process.env.THEOKIT_API_KEY ?? "theo_test_cloud",
  model: { id: "openai/gpt-4o-mini" },
  systemPrompt: "You are a release bot.",
  cloud: {
    env: { type: "cloud" },
    autoCreatePR: true,
    repos: [{ url: "https://github.com/acme/widget", startingRef: "main" }],
  },
});

const payload = (agent as { cloudPayload: any }).cloudPayload;

console.log("agentId prefix:", agent.agentId.slice(0, 3));   // bc- for cloud, agent- for local
console.log("schemaVersion: ", payload.schemaVersion);
console.log("autoCreatePR:  ", payload.cloud.autoCreatePR);
console.log("repo:          ", payload.cloud.repos[0].url);
console.log("model:         ", payload.model.id);

await agent.dispose?.();
