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
if (token === undefined || token.length === 0) {
  console.error(
    "AWS_BEARER_TOKEN_BEDROCK is required. Generate via AWS Console or " +
      "`aws iam create-service-specific-credential --service-name bedrock.amazonaws.com`.",
  );
  process.exit(1);
}

const modelId =
  process.env.BEDROCK_MODEL ?? "bedrock/us.anthropic.claude-sonnet-4-5-v1:0";

const agent = await Agent.create({
  apiKey: token,
  model: { id: modelId },
  local: { cwd: process.cwd(), sandboxOptions: { enabled: false } as const },
  name: "bedrock-bot",
  systemPrompt: "You are a concise assistant. Reply in one short sentence.",
});

const question = process.argv[2] ?? "Qual é a capital do Brasil?";
console.log(`[bedrock] model=${modelId} question="${question}"`);

const run = await agent.send(question);
const result = await run.wait();
console.log(`[bedrock] status=${result.status} resultLen=${(result.result ?? "").length}`);
console.log(result.result ?? "(no reply)");

await agent.dispose();
