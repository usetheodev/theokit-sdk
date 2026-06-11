/**
 * Recipe 02 — Search Google Drive.
 *
 * Read-only mode. Demonstrates the `searchGoogleDocs` + `listGoogleDocs`
 * upstream tools.
 */

import { Agent } from "@theokit/sdk";
import { googleWorkspace } from "@theokit/skills-google-workspace";

import { requireCreds } from "./lib/scope-gate.js";

const { providerKey, account } = requireCreds("recipe-02");

const query = process.argv.slice(2).join(" ") || "report";

const agent = await Agent.create({
  apiKey: providerKey,
  model: { id: "openai/gpt-4o-mini" },
  systemPrompt:
    "You are a Drive search assistant. Reply with a numbered list of " +
    "matches — file name + last modified date.",
  mcpServers: googleWorkspace(account !== undefined ? { account } : {}),
});

try {
  const run = await agent.send(
    `Search my Google Drive for files matching "${query}". ` +
      `Return up to 5 results.`,
  );
  const result = await run.wait();
  console.log("--- agent reply ---");
  console.log(result.result ?? "(no reply)");
} finally {
  await agent.dispose();
}
