/**
 * GCP Vertex AI demo (Adoption Roadmap #8; ADRs D286-D302).
 *
 * Sends a one-shot prompt to Gemini (or Claude on Vertex) and prints the reply.
 * Uses Application Default Credentials via `google-auth-library`.
 *
 * Run:
 *   gcloud auth application-default login
 *   cp .env.example .env  # fill GOOGLE_CLOUD_PROJECT
 *   pnpm install
 *   pnpm run run
 */

import { Agent } from "@theokit/sdk";

if (process.env.GOOGLE_CLOUD_PROJECT === undefined) {
  console.error(
    "GOOGLE_CLOUD_PROJECT is required. Set it in .env or run " +
      "`gcloud config set project <id>`.",
  );
  process.exit(1);
}

const modelId =
  process.env.VERTEX_MODEL ?? "vertex/google/gemini-2.0-flash-001";

// For Vertex, apiKey isn't strictly used — ADC resolves the OAuth token
// lazily inside the client. We pass an empty placeholder.
const agent = await Agent.create({
  apiKey: "vertex-adc",
  model: { id: modelId },
  local: { cwd: process.cwd(), sandboxOptions: { enabled: false } as const },
  name: "vertex-bot",
  systemPrompt: "You are a concise assistant. Reply in one short sentence.",
});

const question = process.argv[2] ?? "Qual é a capital do Brasil?";
console.log(
  `[vertex] model=${modelId} project=${process.env.GOOGLE_CLOUD_PROJECT} ` +
    `location=${process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1"} question="${question}"`,
);

const run = await agent.send(question);
const result = await run.wait();
console.log(`[vertex] status=${result.status} resultLen=${(result.result ?? "").length}`);
console.log(result.result ?? "(no reply)");

await agent.dispose();
