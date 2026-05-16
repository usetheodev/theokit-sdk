import {
  Agent,
  AuthenticationError,
  ConfigurationError,
  UnknownAgentError,
} from "@usetheo/sdk";

/**
 * Typed error handling. Each public error class extends
 * `TheokitAgentError` and carries a stable `code` string plus
 * `isRetryable` flag, so callers can branch on category cheaply.
 *
 * Triggers three scenarios that produce deterministic errors:
 *   1. Missing API key                → AuthenticationError
 *   2. Both local and cloud passed   → ConfigurationError
 *   3. Agent.get with bogus id        → UnknownAgentError
 *
 * Uses fixture mode (no provider key needed) so the errors fire
 * deterministically without depending on the network.
 */

async function expectAuthError(): Promise<void> {
  try {
    await Agent.create({
      apiKey: "",
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd: process.cwd() },
    });
    console.log("[1 missing key] unexpected success");
  } catch (cause) {
    if (cause instanceof AuthenticationError) {
      console.log(`[1 missing key] ✓ AuthenticationError code=${cause.code}`);
    } else {
      console.log(`[1 missing key] unexpected: ${(cause as Error).name}`);
    }
  }
}

async function expectConfigError(): Promise<void> {
  try {
    await Agent.create({
      apiKey: "theo_test_demo",
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd: process.cwd() },
      cloud: { repos: [{ url: "https://github.com/usetheo/example" }] },
    });
    console.log("[2 local+cloud] unexpected success");
  } catch (cause) {
    if (cause instanceof ConfigurationError) {
      console.log(`[2 local+cloud] ✓ ConfigurationError code=${cause.code}`);
    } else {
      console.log(`[2 local+cloud] unexpected: ${(cause as Error).name}`);
    }
  }
}

async function expectUnknownAgent(): Promise<void> {
  try {
    await Agent.get("agent-does-not-exist-00000000");
    console.log("[3 unknown agent] unexpected success");
  } catch (cause) {
    if (cause instanceof UnknownAgentError) {
      console.log(`[3 unknown agent] ✓ UnknownAgentError code=${cause.code}`);
    } else {
      console.log(`[3 unknown agent] unexpected: ${(cause as Error).name}`);
    }
  }
}

async function main(): Promise<void> {
  await expectAuthError();
  await expectConfigError();
  await expectUnknownAgent();
}

main().catch((cause) => {
  console.error("error-handling failed:", cause);
  process.exit(1);
});
