/**
 * Env-gating helper for all recipes (real-LLM-validation rule).
 *
 * Recipes refuse to run unless BOTH the provider key AND the Google
 * credentials sentinel are set. This keeps the cookbook honest per
 * `.claude/rules/real-llm-validation.md` — without creds, recipes skip
 * with a clear message rather than crashing or hallucinating.
 */

import { existsSync } from "node:fs";

export interface Gate {
  readonly providerKey: string;
  readonly account: string | undefined;
}

export function requireCreds(recipeName: string): Gate {
  const providerKey = process.env.OPENROUTER_API_KEY ?? "";
  const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "";
  if (providerKey.length === 0) {
    console.log(
      `[${recipeName}] skipped — OPENROUTER_API_KEY (or any provider key) is not set.`,
    );
    process.exit(0);
  }
  if (credsPath.length === 0 || !existsSync(credsPath)) {
    console.log(
      `[${recipeName}] skipped — GOOGLE_APPLICATION_CREDENTIALS not set or file missing. ` +
        `Run \`npx theokit setup gworkspace\` first.`,
    );
    process.exit(0);
  }
  const account = process.env.GOOGLE_WORKSPACE_ACCOUNT;
  return {
    providerKey,
    account: typeof account === "string" && account.length > 0 ? account : undefined,
  };
}
