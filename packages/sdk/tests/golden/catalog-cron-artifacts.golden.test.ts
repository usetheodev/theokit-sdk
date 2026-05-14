import { afterEach, describe, expect, it } from "vitest";

import { Agent, Cron, Theokit } from "../../src/index.js";
import { assertGoldenHasContractSignal, normalizeForGolden } from "../helpers/normalize.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers/temp-workspace.js";
import localDownloadUnsupportedErrorGolden from "./artifacts/local-download-unsupported-error.json";
import localListEmptyGolden from "./artifacts/local-list-empty.json";
import cloudJobGolden from "./cron/cloud-job.json";
import localJobGolden from "./cron/local-job.json";
import meGolden from "./theokit/me.json";
import modelsGolden from "./theokit/models.json";
import repositoriesGolden from "./theokit/repositories.json";

describe("catalog, cron, and artifacts golden contracts", () => {
  let workspace: TempWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
    workspace = undefined;
  });

  it("matches normalized Theokit account and catalog goldens", async () => {
    const options = { apiKey: "theo_test_contract_key" };

    const me = normalizeForGolden(await Theokit.me(options));
    const models = normalizeForGolden(await Theokit.models.list(options));
    const repositories = normalizeForGolden(await Theokit.repositories.list(options));

    assertGoldenHasContractSignal(me);
    assertGoldenHasContractSignal(models);
    expect(me).toEqual(meGolden);
    expect(models).toEqual(modelsGolden);
    expect(repositories).toEqual(repositoriesGolden);
  });

  it("matches normalized local cron job golden", async () => {
    workspace = await createTempWorkspace("simple-node-project");
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      local: { cwd: workspace.cwd },
    });

    const job = await Cron.create({
      cron: "@hourly",
      timezone: "UTC",
      message: "Run local scheduled task",
      agentId: agent.agentId,
    });
    const normalized = normalizeForGolden(job);

    assertGoldenHasContractSignal(normalized);
    expect(normalized).toEqual(localJobGolden);
  });

  it("matches normalized cloud cron job golden", async () => {
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      cloud: { repos: [{ url: "https://github.com/usetheo/example" }] },
    });

    const job = await Cron.create({
      cron: "0 9 * * *",
      timezone: "America/Sao_Paulo",
      message: "Run cloud scheduled task",
      agentId: agent.agentId,
      apiKey: "theo_test_contract_key",
    });
    const normalized = normalizeForGolden(job);

    assertGoldenHasContractSignal(normalized);
    expect(normalized).toEqual(cloudJobGolden);
  });

  it("matches normalized local artifacts goldens", async () => {
    workspace = await createTempWorkspace("simple-node-project");
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "composer-2" },
      local: { cwd: workspace.cwd },
    });

    const artifacts = await agent.listArtifacts();
    expect(normalizeForGolden(artifacts)).toEqual(localListEmptyGolden);

    await expect(agent.downloadArtifact("report.txt")).rejects.toSatisfy((error: unknown) => {
      const normalized = normalizeForGolden(error);
      assertGoldenHasContractSignal(normalized);
      expect(normalized).toEqual(localDownloadUnsupportedErrorGolden);
      return true;
    });
  });
});
