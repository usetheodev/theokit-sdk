/**
 * Recipe 05 — Create a calendar event (WRITE).
 *
 * Requires `writable: true`. Demonstrates the upstream `createCalendarEvent`
 * tool. EC-4: if the upstream rejects the call (read-only token), we
 * surface a clear scope-upgrade hint.
 */

import { Agent } from "@theokit/sdk";
import { googleWorkspace } from "@theokit/skills-google-workspace";

import { requireCreds } from "./lib/scope-gate.js";

const { providerKey, account } = requireCreds("recipe-05");

const agent = await Agent.create({
  apiKey: providerKey,
  model: { id: "openai/gpt-4o-mini" },
  systemPrompt:
    "You are a calendar agent. Create a SINGLE 30-minute event tomorrow at 10:00 local time " +
    "titled 'theokit skills-google-workspace recipe-05 test'. Output the created event id " +
    "and HTML link, or report the error verbatim.",
  mcpServers: googleWorkspace({
    writable: true,
    ...(account !== undefined ? { account } : {}),
  }),
});

try {
  const run = await agent.send(
    "Create the test calendar event per your system prompt. " +
      "If the tool rejects with a 403 / scope error, report it exactly.",
  );
  const result = await run.wait();
  const text = result.result ?? "(no reply)";
  console.log("--- agent reply ---");
  console.log(text);
  // EC-4: surface a scope-upgrade hint when the model echoes a 403 / scope error.
  if (/403|insufficient|scope/i.test(text)) {
    console.log(
      "\n[hint] If you see a scope error, the token was likely created without write " +
        "scopes. Re-run `theokit setup gworkspace --writable=calendar` to re-consent.",
    );
  }
} finally {
  await agent.dispose();
}
