/**
 * Recipe 03 — Read a Google Doc by ID or by name.
 *
 * Read-only mode. The agent will use `searchGoogleDocs` then
 * `readGoogleDoc` to fetch contents.
 */

import { Agent } from "@usetheo/sdk";
import { googleWorkspace } from "@usetheo/skills-google-workspace";

import { requireCreds } from "./lib/scope-gate.js";

const { providerKey, account } = requireCreds("recipe-03");

const target = process.argv.slice(2).join(" ");
if (target.length === 0) {
  console.log("Usage: pnpm recipe-03 <doc id or doc name>");
  process.exit(2);
}

const agent = await Agent.create({
  apiKey: providerKey,
  model: { id: "openai/gpt-4o-mini" },
  systemPrompt:
    "You are a Google Docs reader. Find the document referenced by the user, " +
    "fetch its text content, and produce a 2-sentence summary in plain text.",
  mcpServers: googleWorkspace(account !== undefined ? { account } : {}),
});

try {
  const run = await agent.send(`Summarize the Google Doc: ${target}`);
  const result = await run.wait();
  console.log("--- agent reply ---");
  console.log(result.result ?? "(no reply)");
} finally {
  await agent.dispose();
}
