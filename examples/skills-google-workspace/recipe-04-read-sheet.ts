/**
 * Recipe 04 — Read a range from a Google Sheet.
 *
 * Read-only mode. Demonstrates the upstream `readSpreadsheet` tool.
 */

import { Agent } from "@usetheo/sdk";
import { googleWorkspace } from "@usetheo/skills-google-workspace";

import { requireCreds } from "./lib/scope-gate.js";

const { providerKey, account } = requireCreds("recipe-04");

const sheetId = process.argv[2];
const range = process.argv[3] ?? "Sheet1!A1:D10";
if (sheetId === undefined || sheetId.length === 0) {
  console.log("Usage: pnpm recipe-04 <sheet id> [range]");
  console.log("  range default: Sheet1!A1:D10");
  process.exit(2);
}

const agent = await Agent.create({
  apiKey: providerKey,
  model: { id: "openai/gpt-4o-mini" },
  systemPrompt:
    "You are a spreadsheet assistant. Read the requested range and describe " +
    "the data shape (rows / columns) in one short paragraph.",
  mcpServers: googleWorkspace(account !== undefined ? { account } : {}),
});

try {
  const run = await agent.send(
    `Read range "${range}" from spreadsheet ID "${sheetId}" and describe what you see.`,
  );
  const result = await run.wait();
  console.log("--- agent reply ---");
  console.log(result.result ?? "(no reply)");
} finally {
  await agent.dispose();
}
