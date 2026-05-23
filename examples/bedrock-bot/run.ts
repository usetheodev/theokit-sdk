/**
 * AWS Bedrock demo (Adoption Roadmap #8; ADRs D286-D302).
 *
 * Sends a one-shot prompt to Claude on Bedrock and prints the reply.
 * Uses Bearer auth (no SigV4). Non-streaming in v1 (D302).
 *
 * Run:
 *   cp .env.example .env  # fill AWS_BEARER_TOKEN_BEDROCK
 *   pnpm install
 *   pnpm run run
 */

import { Agent } from "@usetheo/sdk";

const token = process.env.AWS_BEARER_TOKEN_BEDROCK;
const modelId =
  process.env.BEDROCK_MODEL ?? "bedrock/us.anthropic.claude-sonnet-4-5-v1:0";

if (token === undefined || token.length === 0) {
  console.log(
    "[bedrock] AWS_BEARER_TOKEN_BEDROCK not set — SDK will auto-generate " +
      "via @aws/bedrock-token-generator + standard AWS credential chain.",
  );
}

const agent = await Agent.create({
  apiKey: token ?? "__bedrock_lazy_token__",
  model: { id: modelId },
  local: { cwd: process.cwd(), sandboxOptions: { enabled: false } as const },
  name: "bedrock-bot",
  systemPrompt: "You are a concise assistant. Reply in one short sentence.",
});

const question = process.argv[2] ?? "Qual é a capital do Brasil?";
console.log(`[bedrock] model=${modelId} question="${question}"`);

const run = await agent.send(question);
const result = await run.wait();
const errInfo = (result as { error?: { name?: string; message?: string; metadata?: unknown } }).error;
console.log(`[bedrock] status=${result.status} resultLen=${(result.result ?? "").length}`);
if (errInfo !== undefined) {
  console.log(`[bedrock] error.name=${errInfo.name}`);
  console.log(`[bedrock] error.message=${errInfo.message}`);
  console.log(`[bedrock] error.metadata=${JSON.stringify(errInfo.metadata, null, 2)}`);
}
console.log(result.result ?? "(no reply)");

await agent.dispose();
