import { Agent, ConfigurationError } from "@usetheo/sdk";

/**
 * Cloud runtime is pre-release. Non-fixture API keys hitting cloud-only
 * methods (`listArtifacts`, `downloadArtifact`, `Agent.getRun({ runtime: "cloud" })`)
 * throw `ConfigurationError(code: "cloud_runtime_pre_release")`.
 *
 * Fixture mode (`theo_test_*` keys) serves deterministic data. Real keys
 * fail explicitly — never get fixture content masquerading as real PaaS
 * data.
 */
async function main(): Promise<void> {
  const realKey = process.env.THEOKIT_API_KEY ?? "user-real-not-a-fixture-key";

  const agent = await Agent.create({
    apiKey: realKey,
    model: { id: "google/gemini-2.0-flash-exp:free" },
    cloud: { repos: [{ url: "https://github.com/usetheo/example" }] },
  });
  console.log(`Cloud agent created: ${agent.agentId}`);

  console.log("\nTrying agent.listArtifacts() with a non-fixture key...");
  try {
    await agent.listArtifacts();
    console.error("✗ FAIL — call should have thrown.");
    process.exit(1);
  } catch (cause) {
    if (cause instanceof ConfigurationError && cause.code === "cloud_runtime_pre_release") {
      console.log(`✓ Got typed error: ${cause.code}`);
      console.log(`  message: ${cause.message}`);
    } else {
      throw cause;
    }
  }

  console.log("\nTrying agent.downloadArtifact('dist/report.txt')...");
  try {
    await agent.downloadArtifact("dist/report.txt");
    console.error("✗ FAIL — call should have thrown.");
    process.exit(1);
  } catch (cause) {
    if (cause instanceof ConfigurationError && cause.code === "cloud_runtime_pre_release") {
      console.log(`✓ Got typed error: ${cause.code}`);
    } else {
      throw cause;
    }
  }

  console.log("\nTrying Agent.getRun(id, { runtime: 'cloud' })...");
  try {
    await Agent.getRun("any-run-id", { runtime: "cloud" });
    console.error("✗ FAIL — call should have thrown.");
    process.exit(1);
  } catch (cause) {
    if (cause instanceof ConfigurationError && cause.code === "cloud_runtime_pre_release") {
      console.log(`✓ Got typed error: ${cause.code}`);
    } else {
      throw cause;
    }
  }

  console.log("\nAll 3 cloud-only methods threw cloud_runtime_pre_release as expected.");
  await agent.dispose();
}

main().catch((cause) => {
  console.error("cloud-prerelease-guard failed:", cause);
  process.exit(1);
});
