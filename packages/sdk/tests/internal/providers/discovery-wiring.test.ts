import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Agent } from "../../../src/agent.js";
import { _resetDiscovery } from "../../../src/internal/providers/discovery.js";
import { useTempCwd } from "../../helpers/temp-workspace.js";

// This file passed `cwd: process.cwd()`, which during a test run is the package itself, so
// every agent it created persisted a real session into packages/sdk/.theokit/. The helper
// makes process.cwd() report a throwaway directory for this file only.
useTempCwd();

import {
  _resetProvidersForTests,
  getProviderProfile,
} from "../../../src/internal/providers/registry.js";

/**
 * M47 wiring — `Agent.create` MUST trigger provider-plugin discovery (the router's
 * `resolveProviderChain` contract says "discovery is expected to have run upfront
 * (e.g., via Agent.create initialization)"). Without this wiring the whole dynamic
 * loader — trust gate included — is dead code in production.
 */

let tmpHome: string;
let originalHome: string | undefined;

function trustedFixture(name: string): void {
  const dir = join(tmpHome, ".theokit", "plugins", "model-providers", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "index.mjs"),
    `export default {
  name: ${JSON.stringify(name)},
  version: "1.0.0",
  kind: "model-provider",
  profile: { name: ${JSON.stringify(name)}, apiMode: "chat_completions", envVars: [], authType: "api_key",
             baseUrl: "https://fixture.invalid/v1", fallbackModels: [${JSON.stringify(`${name}/m`)}] },
};
`,
  );
  mkdirSync(join(tmpHome, ".theokit", "plugins"), { recursive: true });
  writeFileSync(
    join(tmpHome, ".theokit", "plugins", "trusted-providers.json"),
    JSON.stringify([name]),
  );
}

beforeEach(() => {
  _resetDiscovery();
  _resetProvidersForTests();
  tmpHome = mkdtempSync(join(tmpdir(), "discovery-wiring-"));
  originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
  delete process.env.THEOKIT_TRUSTED_PROVIDERS;
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  _resetDiscovery();
  _resetProvidersForTests();
});

describe("Agent.create wires provider-plugin discovery (M47)", () => {
  it("agent_resume_registers_a_trusted_plugin_profile (F1 — fresh-process resume path)", async () => {
    trustedFixture("wiring-resume-provider");

    const created = await Agent.create({
      apiKey: "sk-test-not-used",
      model: { id: "openai/gpt-4o" },
      local: { cwd: process.cwd() },
    });
    const agentId = created.agentId;
    await created[Symbol.asyncDispose]();

    // Simulate a fresh process: discovery flag + registry reset — resume must re-discover.
    _resetDiscovery();
    _resetProvidersForTests();
    const resumed = await Agent.resume(agentId, { apiKey: "sk-test-not-used" });
    try {
      expect(getProviderProfile("wiring-resume-provider")).toBeDefined();
    } finally {
      await resumed[Symbol.asyncDispose]();
    }
  });

  it("agent_create_registers_a_trusted_plugin_profile", async () => {
    trustedFixture("wiring-fixture-provider");

    const agent = await Agent.create({
      apiKey: "sk-test-not-used",
      model: { id: "openai/gpt-4o" },
      local: { cwd: process.cwd() },
    });
    try {
      expect(getProviderProfile("wiring-fixture-provider")).toBeDefined();
    } finally {
      await agent[Symbol.asyncDispose]();
    }
  });
});
