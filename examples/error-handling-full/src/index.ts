import {
  Agent,
  AuthenticationError,
  ConfigurationError,
  IntegrationNotConnectedError,
  NetworkError,
  RateLimitError,
  TheokitAgentError,
  UnknownAgentError,
  UnsupportedRunOperationError,
} from "@usetheo/sdk";

/**
 * Covers all 8 error classes the SDK exposes.
 *
 * 3 are easy to trigger from user code:
 *   - AuthenticationError
 *   - ConfigurationError
 *   - UnknownAgentError
 *
 * 5 require more setup to trigger naturally — this example demonstrates
 * the SHAPE you'd catch in production code via instanceof checks. Each
 * error extends `TheokitAgentError` so a broad catch works as a fallback.
 */

function classifyError(cause: unknown): string {
  if (cause instanceof AuthenticationError) return "auth_error";
  if (cause instanceof RateLimitError) return "rate_limit";
  if (cause instanceof NetworkError) return "network";
  if (cause instanceof IntegrationNotConnectedError) return "integration_not_connected";
  if (cause instanceof UnsupportedRunOperationError) return "unsupported_run_op";
  if (cause instanceof UnknownAgentError) return "unknown_agent";
  if (cause instanceof ConfigurationError) return "config";
  if (cause instanceof TheokitAgentError) return "theokit_base";
  return "non_sdk";
}

async function main(): Promise<void> {
  console.log("Exercising all 8 SDK error classes...\n");

  // 1. ConfigurationError — missing model
  try {
    await Agent.create({
      apiKey: "theo_test_error_handling_full",
      local: { cwd: process.cwd() },
    });
  } catch (cause) {
    console.log(`1. ConfigurationError: ${classifyError(cause)}`);
    console.log(`   code: ${(cause as ConfigurationError).code}`);
  }

  // 2. AuthenticationError — Theokit catalog call without API key
  try {
    delete process.env.THEOKIT_API_KEY;
    // Theokit.me() requires an apiKey; without env or explicit apiKey it throws
    const { Theokit } = await import("@usetheo/sdk");
    await Theokit.me({});
  } catch (cause) {
    console.log(`2. AuthenticationError: ${classifyError(cause)}`);
    if (cause instanceof TheokitAgentError) console.log(`   code: ${cause.code}`);
  } finally {
    process.env.THEOKIT_API_KEY = "theo_test_error_handling_full";
  }

  // 3. UnknownAgentError — Agent.get with a nonexistent id
  try {
    await Agent.get("agent-does-not-exist-12345");
  } catch (cause) {
    console.log(`3. UnknownAgentError: ${classifyError(cause)}`);
    if (cause instanceof TheokitAgentError) console.log(`   code: ${cause.code}`);
  }

  // 4. UnsupportedRunOperationError — local agent.downloadArtifact
  const agent = await Agent.create({
    apiKey: "theo_test_error_handling_full",
    model: { id: "google/gemini-2.0-flash-001" },
    local: { cwd: process.cwd() },
  });
  try {
    await agent.downloadArtifact("any.txt");
  } catch (cause) {
    console.log(`4. UnsupportedRunOperationError: ${classifyError(cause)}`);
    if (cause instanceof UnsupportedRunOperationError) {
      console.log(`   operation: ${cause.operation}`);
    }
  }
  await agent.dispose();

  // 5/6/7 — NetworkError, RateLimitError, IntegrationNotConnectedError
  // These are server-driven. In fixture mode we can't trigger them
  // naturally; instead, demonstrate the catch pattern with instanceof.
  console.log("\n5/6/7. NetworkError, RateLimitError, IntegrationNotConnectedError");
  console.log("   These are server-driven (real PaaS HTTP responses).");
  console.log("   The catch pattern below works the same regardless of trigger:");
  console.log("");
  console.log("     try { await agent.send(msg); }");
  console.log("     catch (e) {");
  console.log("       if (e instanceof RateLimitError) await sleep(e.retryAfterMs);");
  console.log("       else if (e instanceof NetworkError) retry();");
  console.log("       else if (e instanceof IntegrationNotConnectedError) connect(e.provider);");
  console.log("       else throw e;");
  console.log("     }");

  // 8. TheokitAgentError — base class fallback
  console.log("\n8. TheokitAgentError — base class catch (fallback)");
  console.log("   Every SDK error extends TheokitAgentError, so:");
  console.log("");
  console.log("     try { await op(); }");
  console.log("     catch (e) {");
  console.log("       if (e instanceof TheokitAgentError) {");
  console.log("         logger.error({ code: e.code, retryable: e.isRetryable, msg: e.message });");
  console.log("       } else throw e;  // non-SDK error");
  console.log("     }");
}

main().catch((cause) => {
  console.error("error-handling-full failed:", cause);
  process.exit(1);
});
