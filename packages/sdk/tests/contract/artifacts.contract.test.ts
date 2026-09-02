import { afterEach, describe, expect, it } from "vitest";

import { Agent } from "../../src/index.js";
import localDownloadErrorGolden from "../golden/artifacts/local-download-unsupported-error.json";
import localListGolden from "../golden/artifacts/local-list-empty.json";
import { normalizeForGolden } from "../helpers/normalize.js";
import { createTempWorkspace, type TempWorkspace, useTempCwd } from "../helpers/temp-workspace.js";

/**
 * A cloud agent has no local working directory, so these cases pass no `local.cwd` — but the agent
 * REGISTRY still lands under `process.cwd()`, which during a test run is `packages/sdk/` itself.
 * Measured 2026-09-01: this file wrote a real `.theokit/agents/registry.json` into the package tree
 * on every run, invisible to `git status` because `.gitignore` hides it.
 *
 * Passing a `local.cwd` to a cloud agent would be a lie about what the agent is; redirecting
 * `process.cwd()` for the file is the honest fix, and is why this helper exists.
 */
useTempCwd();

describe("agent artifacts contract", () => {
  let workspace: TempWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
    workspace = undefined;
  });

  it("local agents list no artifacts and reject download with a public error", async () => {
    workspace = await createTempWorkspace("simple-node-project");
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd: workspace.cwd },
    });

    await expect(agent.listArtifacts()).resolves.toEqual(localListGolden);
    await expect(agent.downloadArtifact("report.txt")).rejects.toMatchObject(
      localDownloadErrorGolden,
    );
  });

  it("cloud agents list artifact metadata and download artifact bytes", async () => {
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "google/gemini-2.0-flash-001" },
      cloud: { repos: [{ url: "https://github.com/usetheo/example" }] },
    });

    const artifacts = await agent.listArtifacts();
    const bytes = await agent.downloadArtifact("dist/report.txt");

    expect(normalizeForGolden(artifacts)).toEqual([
      expect.objectContaining({
        path: "dist/report.txt",
        sizeBytes: expect.any(Number),
        updatedAt: "<timestamp>",
      }),
    ]);
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(bytes.length).toBeGreaterThan(0);
    await expect(agent.downloadArtifact("../secret.txt")).rejects.toMatchObject({
      name: "ConfigurationError",
      code: expect.any(String),
    });
    await expect(agent.downloadArtifact("missing.txt")).rejects.toMatchObject({
      name: "UnknownAgentError",
      code: expect.any(String),
    });
  });
});
