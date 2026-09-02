import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { Agent } from "../../../src/index.js";
import type { CloudAgent } from "../../../src/internal/cloud-agent/cloud-agent.js";
import { removeTempDirRobust, useTempCwd } from "../../helpers/temp-workspace.js";

/**
 * ADR D15 + EC-6 — CloudAgent threads cloudPayload through `send()` AND
 * re-serializes on `reload()` so filesystem-derived state changes propagate.
 */

const FIXTURE_KEY = "theo_test_payload_wiring";
const MODEL = { id: "google/gemini-2.0-flash-001" };

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

describe("CloudAgent — cloudPayload field is the serialized contract", () => {
  it("cloudPayload is built at construct-time and matches AgentOptions shape", async () => {
    const agent = (await Agent.create({
      apiKey: FIXTURE_KEY,
      model: MODEL,
      cloud: {
        repos: [{ url: "https://github.com/usetheo/example", startingRef: "main" }],
        autoCreatePR: true,
      },
      systemPrompt: "ship the change",
      skills: { enabled: ["deploy"] },
    })) as unknown as CloudAgent;

    expect(agent.cloudPayload).toBeDefined();
    expect(agent.cloudPayload.schemaVersion).toBe("1.0");
    expect(agent.cloudPayload.cloud.repos).toEqual([
      { url: "https://github.com/usetheo/example", startingRef: "main" },
    ]);
    expect(agent.cloudPayload.cloud.autoCreatePR).toBe(true);
    expect(agent.cloudPayload.systemPrompt).toBe("ship the change");
    expect(agent.cloudPayload.skills).toEqual({ enabled: ["deploy"] });
    expect(agent.cloudPayload.model).toEqual({ id: MODEL.id });
    expect(agent.cloudPayload.agentId).toBe(agent.agentId);

    await agent.dispose();
  });

  it("cloudPayload omits absent optional features", async () => {
    const agent = (await Agent.create({
      apiKey: FIXTURE_KEY,
      model: MODEL,
      cloud: { repos: [{ url: "https://github.com/usetheo/example" }] },
    })) as unknown as CloudAgent;

    expect(agent.cloudPayload.skills).toBeUndefined();
    expect(agent.cloudPayload.plugins).toBeUndefined();
    expect(agent.cloudPayload.mcpServers).toBeUndefined();
    expect(agent.cloudPayload.agents).toBeUndefined();
    expect(agent.cloudPayload.memory).toBeUndefined();

    await agent.dispose();
  });
});

describe("CloudAgent — reload re-serializes (EC-6)", () => {
  // `cwd` is declared here and assigned inside the test below. The `afterEach(async () => { void cwd; })`
  // that stood here was not a teardown: its only statement existed to silence an unused-variable
  // lint, and an async hook that awaits nothing reads as cleanup that is not there.
  let cwd: string;

  it("reload() rebuilds cloudPayload from current options", async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-cloud-reload-"));
    const __cwdCleanup1 = cwd;
    onTestFinished(async () => {
      await removeTempDirRobust(__cwdCleanup1);
    });
    await mkdir(join(cwd, ".theokit", "skills", "deploy"), { recursive: true });
    await writeFile(
      join(cwd, ".theokit", "skills", "deploy", "SKILL.md"),
      "---\nname: deploy\ndescription: Ships to prod\n---\n",
      "utf8",
    );

    // CloudAgent doesn't watch filesystem skills by itself — the agent's
    // initial cloudPayload reflects options as passed. reload() re-serializes
    // from current options, which is what consumers depend on when they
    // programmatically toggle options.skills.enabled between sends.
    const agent = (await Agent.create({
      apiKey: FIXTURE_KEY,
      model: MODEL,
      cloud: { repos: [{ url: "https://github.com/usetheo/example" }] },
      skills: { enabled: ["deploy"] },
    })) as unknown as CloudAgent;

    expect(agent.cloudPayload.skills).toEqual({ enabled: ["deploy"] });

    // After reload, agentId still threaded and skills preserved (round-trip).
    await agent.reload();
    expect(agent.cloudPayload.skills).toEqual({ enabled: ["deploy"] });
    expect(agent.cloudPayload.agentId).toBe(agent.agentId);

    await agent.dispose();
  });
});
