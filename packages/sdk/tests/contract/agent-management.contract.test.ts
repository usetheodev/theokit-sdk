import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Agent } from "../../src/index.js";
import cloudAgentInfoGolden from "../golden/agent/cloud-agent-info.json";
import localAgentInfoGolden from "../golden/agent/local-agent-info.json";
import { normalizeForGolden } from "../helpers/normalize.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers/temp-workspace.js";

describe("Agent management contract", () => {
  let workspace: TempWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
    workspace = undefined;
  });

  it("lists and gets local agents with stable SDKAgentInfo shape and pagination", async () => {
    workspace = await createTempWorkspace("simple-node-project");
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      name: "Contract Local Agent",
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd: workspace.cwd },
    });

    const listed = await Agent.list({ runtime: "local", cwd: workspace.cwd, limit: 10 });
    const fetched = await Agent.get(agent.agentId, { cwd: workspace.cwd });

    expect(listed).toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ agentId: agent.agentId })]),
    });
    expect(listed.items.length).toBeGreaterThanOrEqual(1);
    expect(normalizeForGolden(fetched)).toEqual(localAgentInfoGolden);
  });

  it("renames a local agent — the registry name field is the public rename target", async () => {
    workspace = await createTempWorkspace("simple-node-project");
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      name: "Before Rename",
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd: workspace.cwd },
    });

    await Agent.rename(agent.agentId, "After Rename", { cwd: workspace.cwd });

    const fetched = await Agent.get(agent.agentId, { cwd: workspace.cwd });
    expect(fetched.name).toBe("After Rename");
  });

  // B-045. These four were one `it` named "lists, filters, archives, unarchives, and deletes
  // cloud agents" — five independent contracts behind a single reported case. Nothing about the
  // archive contract requires the list contract to have been checked first, so this was never a
  // journey; a failure anywhere left the remaining operations unverified and the report named one
  // test for five contracts. Split, over the shared fixture the DoD asks for.
  describe("cloud agent lifecycle", () => {
    const CLOUD_KEY = "theo_test_contract_key";
    let cloudAgentId: string;

    beforeEach(async () => {
      const agent = await Agent.create({
        apiKey: CLOUD_KEY,
        name: "Contract Cloud Agent",
        model: { id: "google/gemini-2.0-flash-001" },
        cloud: {
          repos: [{ url: "https://github.com/usetheo/example" }],
          autoCreatePR: true,
        },
      });
      cloudAgentId = agent.agentId;
    });

    // Review correction. This was one test named "lists and filters cloud agents by prUrl, and
    // gets the stable SDKAgentInfo shape" — an "and" joining two independent claims, and its only
    // list oracle was `arrayContaining`, a SUPERSET matcher: a list that ignored every filter and
    // returned everything passed it just the same. `includeArchived` and `limit` were passed and
    // never asserted.
    //
    // MEASURED, in an isolated worktree, before rewriting: `Agent.list` does not filter by
    // `prUrl` AT ALL. Two cloud agents on different repos, listed with
    // prUrl=".../usetheo/example/pull/123" — both came back. `limit: 1` returned 8 items. The
    // implementation (src/agent.ts:358 → internal/runtime/registry/agent-registry.ts:129-134)
    // filters on `runtime` and `cwd` and nothing else; `prUrl`, `includeArchived`, `limit` and
    // `cursor` are accepted by the type and silently dropped.
    //
    // So an oracle asserting a non-matching agent is ABSENT cannot pass — the gap is in the
    // product, not in this test, and closing it is not a test-only change. Filed as a finding
    // rather than papered over with a matcher that agrees with any implementation. The filter
    // options are dropped from the arrange below because passing an inert option and asserting
    // nothing about it is the exact smell this correction is about.
    //
    // What IS implemented is scoping by `runtime` + `cwd`, so the oracle is an ABSENCE assertion:
    // a superset matcher cannot fail, an absence assertion can. Measured killing power, three
    // mutants in an isolated worktree on internal/runtime/registry/agent-registry.ts:129-134:
    //
    //   runtime filter disabled only  → test SURVIVES
    //   cwd filter disabled only      → test SURVIVES
    //   BOTH disabled                 → test DIES
    //
    // Stated rather than implied: the two filters are CONFOUNDED for this fixture. A cloud agent
    // always registers under `process.cwd()` while a local agent needs a temp workspace, so either
    // filter alone already excludes the neighbour and no single-filter mutant can be isolated from
    // the public API — the only way to separate them would be registering a local agent in the
    // repository cwd, which writes registry state into the working tree. So this test detects the
    // compound failure (list scoping removed), not a specific filter. That is weaker than the
    // usual bar, and weaker than the name would suggest if the name claimed "runtime".
    it("lists cloud agents without leaking an agent scoped elsewhere into the result", async () => {
      workspace = await createTempWorkspace("simple-node-project");
      const localAgent = await Agent.create({
        apiKey: CLOUD_KEY,
        name: "Local Neighbour",
        model: { id: "google/gemini-2.0-flash-001" },
        local: { cwd: workspace.cwd },
      });

      const listed = await Agent.list({ runtime: "cloud", apiKey: CLOUD_KEY });
      const ids = listed.items.map((info) => info.agentId);

      expect(ids, "the cloud agent must be listed").toContain(cloudAgentId);
      expect(
        ids,
        "and an agent scoped to another runtime AND another cwd must NOT be — this is the half a superset matcher cannot check",
      ).not.toContain(localAgent.agentId);
      await localAgent.dispose();
    });

    it("gets a cloud agent with the stable SDKAgentInfo shape", async () => {
      const fetched = await Agent.get(cloudAgentId, { apiKey: CLOUD_KEY });

      expect(normalizeForGolden(fetched)).toEqual(cloudAgentInfoGolden);
    });

    it("archive flips archived to true", async () => {
      await expect(Agent.get(cloudAgentId, { apiKey: CLOUD_KEY })).resolves.toMatchObject({
        archived: false,
      });

      await expect(Agent.archive(cloudAgentId, { apiKey: CLOUD_KEY })).resolves.toBeUndefined();

      await expect(Agent.get(cloudAgentId, { apiKey: CLOUD_KEY })).resolves.toMatchObject({
        archived: true,
      });
    });

    it("unarchive flips archived back to false", async () => {
      // Review correction. Arranging through `Agent.archive` means a broken ARCHIVE fails this
      // test too, and a red named "unarchive flips…" would then point at the wrong operation.
      // There is no public path to an archived agent other than archive(), so the precondition
      // carries its own message: the failure output says PRECONDITION and names archive.
      await Agent.archive(cloudAgentId, { apiKey: CLOUD_KEY });
      await expect(
        Agent.get(cloudAgentId, { apiKey: CLOUD_KEY }),
        "PRECONDITION (not the behaviour under test): archive must have set archived=true — if this line is the failure, the defect is in archive, not unarchive",
      ).resolves.toMatchObject({
        archived: true,
      });

      await expect(Agent.unarchive(cloudAgentId, { apiKey: CLOUD_KEY })).resolves.toBeUndefined();

      await expect(Agent.get(cloudAgentId, { apiKey: CLOUD_KEY })).resolves.toMatchObject({
        archived: false,
      });
    });

    it("delete removes the agent — a later get fails with UnknownAgentError", async () => {
      await expect(Agent.delete(cloudAgentId, { apiKey: CLOUD_KEY })).resolves.toBeUndefined();

      await expect(Agent.get(cloudAgentId, { apiKey: CLOUD_KEY })).rejects.toMatchObject({
        name: "UnknownAgentError",
        code: expect.any(String),
      });
    });
  });

  it("lists and gets runs for an agent without losing Run operations", async () => {
    workspace = await createTempWorkspace("simple-node-project");
    const agent = await Agent.create({
      apiKey: "theo_test_contract_key",
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd: workspace.cwd },
    });
    const run = await agent.send("Summarize fixture for listRuns.");
    await run.wait();

    const listedRuns = await Agent.listRuns(agent.agentId, {
      runtime: "local",
      cwd: workspace.cwd,
      limit: 10,
    });
    const fetchedRun = await Agent.getRun(run.id, { runtime: "local", cwd: workspace.cwd });

    expect(listedRuns.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: run.id,
          agentId: agent.agentId,
          wait: expect.any(Function),
          stream: expect.any(Function),
          conversation: expect.any(Function),
        }),
      ]),
    );
    expect(fetchedRun).toMatchObject({
      id: run.id,
      agentId: agent.agentId,
      status: "finished",
      wait: expect.any(Function),
    });
  });

  it("requires parent agentId for cloud getRun and routes by bc prefix", async () => {
    await expect(
      Agent.getRun("run-00000000-0000-4000-8000-000000000001", { runtime: "cloud" } as never),
    ).rejects.toMatchObject({
      name: "ConfigurationError",
      message: expect.stringMatching(/agentId/i),
    });

    const run = await Agent.getRun("run-00000000-0000-4000-8000-000000000001", {
      runtime: "cloud",
      agentId: "bc-00000000-0000-4000-8000-000000000001",
      apiKey: "theo_test_contract_key",
    });

    expect(run).toMatchObject({
      id: expect.stringMatching(/^run-/),
      agentId: expect.stringMatching(/^bc-/),
      supports: expect.any(Function),
    });
  });
});
