/**
 * Recipe 06 — COMBINED: find next meeting in Calendar → draft agenda in Drive.
 *
 * The cross-product value-add of `@theokit/skills-google-workspace` over
 * three independent servers. Read-only Calendar + writable Drive (via
 * the agent's single MCP server in writable mode).
 *
 * EC-4: catches and surfaces Drive 403 with a clear scope hint.
 */

import { Agent } from "@theokit/sdk";
import { googleWorkspace } from "@theokit/skills-google-workspace";

import { requireCreds } from "./lib/scope-gate.js";

const { providerKey, account } = requireCreds("recipe-06");

const agent = await Agent.create({
  apiKey: providerKey,
  model: { id: "openai/gpt-4o-mini" },
  systemPrompt: [
    "You are an executive assistant agent. Multi-step workflow:",
    "  1. Find the very next upcoming event on the primary calendar.",
    "  2. Use the event title + attendees to draft a 4-bullet agenda.",
    "  3. Create a new Google Doc titled 'Agenda — <event title>' containing the agenda.",
    "  4. Reply with the Doc URL.",
    "If any step fails because of a scope or permission error, report it verbatim.",
  ].join("\n"),
  mcpServers: googleWorkspace({
    writable: true,
    ...(account !== undefined ? { account } : {}),
  }),
});

try {
  const run = await agent.send(
    "Run the workflow now. Use the primary calendar; if there are no upcoming events, " +
      "say so honestly and skip Doc creation.",
  );
  const result = await run.wait();
  const text = result.result ?? "(no reply)";
  console.log("--- agent reply ---");
  console.log(text);
  if (/403|insufficient|scope/i.test(text)) {
    console.log(
      "\n[hint] Drive write rejected — re-run `theokit setup gworkspace --writable=drive` " +
        "to re-consent with write scopes.",
    );
  }
} finally {
  await agent.dispose();
}
