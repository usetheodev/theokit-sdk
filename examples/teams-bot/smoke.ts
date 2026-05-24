/**
 * Microsoft Teams live smoke (T5.2).
 *
 * Validates that the SDK can initialize against the configured Azure AD app.
 * Does NOT send a message (proactive send requires a previously-active
 * conversation, which is out of scope for a one-shot smoke).
 *
 * Skips silently when credentials are absent — per
 * `.claude/rules/real-llm-validation.md` we never claim "validated" without
 * a real backend hit.
 */

import { TeamsAdapter } from "@usetheo/gateway-teams";

const CLIENT_ID = process.env.TEAMS_CLIENT_ID;
const CLIENT_SECRET = process.env.TEAMS_CLIENT_SECRET;
const TENANT_ID = process.env.TEAMS_TENANT_ID;

if (
  CLIENT_ID === undefined || CLIENT_ID.length === 0
  || CLIENT_SECRET === undefined || CLIENT_SECRET.length === 0
  || TENANT_ID === undefined || TENANT_ID.length === 0
) {
  console.log(
    "[teams-smoke] skipped — set TEAMS_CLIENT_ID, TEAMS_CLIENT_SECRET, TEAMS_TENANT_ID to run the live smoke.",
  );
  process.exit(0);
}

const adapter = new TeamsAdapter({
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  tenantId: TENANT_ID,
});

console.log("[teams-smoke] attempting connect with provided credentials...");
const ok = await adapter.connect();
if (ok) {
  console.log("[teams-smoke] PASS — adapter connected; SDK accepted credentials.");
  await adapter.disconnect();
  process.exit(0);
}
console.log("[teams-smoke] FAIL — adapter could not connect. Check tenant_id / client_id / client_secret.");
process.exit(1);
