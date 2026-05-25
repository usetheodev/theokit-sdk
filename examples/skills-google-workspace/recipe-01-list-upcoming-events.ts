/**
 * Recipe 01 — List upcoming Calendar events.
 *
 * Read-only mode. Requires a real Google account; without creds, skips.
 */

import { Agent } from "@usetheo/sdk";
import { googleWorkspace } from "@usetheo/skills-google-workspace";

import { requireCreds } from "./lib/scope-gate.js";

const { providerKey, account } = requireCreds("recipe-01");

const agent = await Agent.create({
  apiKey: providerKey,
  model: { id: "openai/gpt-4o-mini" },
  systemPrompt:
    "You are a concise calendar assistant. Reply in plain text. " +
    "When listing events, include the event title and start time only.",
  mcpServers: googleWorkspace(account !== undefined ? { account } : {}),
});

try {
  const run = await agent.send(
    "List my upcoming events for the next 7 days from my primary calendar. " +
      "Be concise — title + start time per line. If there are none, say so honestly.",
  );
  const result = await run.wait();
  console.log("--- agent reply ---");
  console.log(result.result ?? "(no reply)");
} finally {
  await agent.dispose();
}
