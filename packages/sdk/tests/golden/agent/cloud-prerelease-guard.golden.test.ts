import { afterEach, describe, expect, it } from "vitest";

import { Agent, ConfigurationError } from "../../../src/index.js";

/**
 * Cloud runtime is pre-release. Real-key callers MUST get an explicit
 * `cloud_runtime_pre_release` error instead of silently receiving fixture
 * artifact data. This locks the no-stubs-no-mocks-no-wired rule.
 */

describe("CloudAgent — pre-release guard for non-fixture keys", () => {
  afterEach(() => {
    delete process.env.THEOKIT_API_BASE_URL;
  });

  it("listArtifacts() throws when the agent is created with a non-fixture key and no base URL", async () => {
    delete process.env.THEOKIT_API_BASE_URL;
    const agent = await Agent.create({
      apiKey: "user-real-prod-shaped-key",
      cloud: { repos: [{ url: "https://github.com/usetheo/example" }] },
    });
    await expect(agent.listArtifacts()).rejects.toBeInstanceOf(ConfigurationError);
    await expect(agent.listArtifacts()).rejects.toMatchObject({
      code: "cloud_runtime_pre_release",
    });
  });

  it("downloadArtifact() throws cloud_runtime_pre_release for non-fixture keys", async () => {
    delete process.env.THEOKIT_API_BASE_URL;
    const agent = await Agent.create({
      apiKey: "user-real-prod-shaped-key",
      cloud: { repos: [{ url: "https://github.com/usetheo/example" }] },
    });
    await expect(agent.downloadArtifact("dist/report.txt")).rejects.toBeInstanceOf(
      ConfigurationError,
    );
    await expect(agent.downloadArtifact("dist/report.txt")).rejects.toMatchObject({
      code: "cloud_runtime_pre_release",
    });
  });

  it("listArtifacts() returns fixture data for theo_test_* fixture keys (documented test mode)", async () => {
    delete process.env.THEOKIT_API_BASE_URL;
    const agent = await Agent.create({
      apiKey: "theo_test_fixture_artifacts",
      cloud: { repos: [{ url: "https://github.com/usetheo/example" }] },
    });
    const artifacts = await agent.listArtifacts();
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.path).toBe("dist/report.txt");
  });

  it("downloadArtifact() rejects path traversal even in fixture mode", async () => {
    delete process.env.THEOKIT_API_BASE_URL;
    const agent = await Agent.create({
      apiKey: "theo_test_path_traversal",
      cloud: { repos: [{ url: "https://github.com/usetheo/example" }] },
    });
    await expect(agent.downloadArtifact("../etc/passwd")).rejects.toMatchObject({
      code: "artifact_path_traversal",
    });
    await expect(agent.downloadArtifact("/etc/passwd")).rejects.toMatchObject({
      code: "artifact_path_traversal",
    });
  });
});
