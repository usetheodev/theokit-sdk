/**
 * B-050 — typed-error coverage for `agent-helpers.ts`'s create-time guards.
 *
 * `runCreateUnderSpan` (via `Agent.create`) refuses several malformed or
 * unresolvable configurations before ever constructing a runtime agent. These
 * refusals are the ones a caller actually meets, and rules/testing.md:59
 * requires a negative-case test to assert the specific typed error class,
 * `code`, and message substring — not merely "it throws".
 *
 * Each test asserts a REJECTED input; per rules/testing.md § 4.2 the accepted
 * input for these same guards is already covered by
 * `tests/security/api-key-validation.test.ts` ("accepts theo_test_fixture")
 * and `tests/golden/agent/custom-tools.golden.test.ts` (a working cloud
 * agent create) — this file adds only the missing refusal paths.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AuthenticationError, ConfigurationError } from "../src/errors.js";
import { Agent } from "../src/index.js";
import { API_KEY_ENV_VAR } from "../src/internal/env.js";
import {
  clearAgentRegistry,
  invalidateRegistryHydration,
} from "../src/internal/runtime/registry/agent-registry.js";

describe("agent-helpers.ts — create-time refusals", () => {
  let cwd: string;
  let savedApiKeyEnv: string | undefined;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-agent-helpers-"));
    savedApiKeyEnv = process.env[API_KEY_ENV_VAR];
    delete process.env[API_KEY_ENV_VAR];
  });

  afterEach(() => {
    if (savedApiKeyEnv === undefined) delete process.env[API_KEY_ENV_VAR];
    else process.env[API_KEY_ENV_VAR] = savedApiKeyEnv;
  });

  it("test_a_local_agent_with_no_api_key_anywhere_is_refused_before_any_runtime_work", async () => {
    await expect(
      Agent.create({ model: { id: "claude-sonnet-4-6" }, local: { cwd } }),
    ).rejects.toMatchObject({
      name: "AuthenticationError",
      code: "missing_api_key",
      message: expect.stringContaining("Missing API key"),
    });
  });

  it("test_a_local_agent_with_no_api_key_rejects_with_the_AuthenticationError_class", async () => {
    await expect(
      Agent.create({ model: { id: "claude-sonnet-4-6" }, local: { cwd } }),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("test_a_cloud_agent_with_no_api_key_anywhere_is_refused_with_a_distinct_configuration_error", async () => {
    await expect(
      Agent.create({ model: { id: "claude-sonnet-4-6" }, cloud: {} }),
    ).rejects.toMatchObject({
      name: "ConfigurationError",
      code: "missing_api_key",
      message: expect.stringContaining("Missing API key for cloud agent"),
    });
  });

  it("test_a_cloud_agent_with_no_api_key_rejects_with_the_ConfigurationError_class", async () => {
    await expect(
      Agent.create({ model: { id: "claude-sonnet-4-6" }, cloud: {} }),
    ).rejects.toBeInstanceOf(ConfigurationError);
  });

  it("test_a_cloud_agent_with_a_too_short_api_key_is_refused_as_malformed", async () => {
    await expect(
      Agent.create({ apiKey: "x", model: { id: "claude-sonnet-4-6" }, cloud: {} }),
    ).rejects.toMatchObject({
      name: "AuthenticationError",
      code: "malformed_api_key",
    });
  });

  it("test_handoffs_without_the_sdk_handoff_package_installed_are_refused_with_install_guidance", async () => {
    // @theokit/sdk-handoff is an optional peer, dynamically imported only when
    // `handoffs` is non-empty. It is not built/installed in this test tree
    // (no packages/sdk-handoff/dist), so the import genuinely fails here —
    // this is not a mocked failure, it is the real "package absent" path.
    await expect(
      Agent.create({
        apiKey: "theo_test_fixture",
        model: { id: "openai/gpt-4o-mini" },
        local: { cwd },
        // biome-ignore lint/suspicious/noExplicitAny: handoffs accepts `unknown` entries; shape is irrelevant — the import fails first.
        handoffs: [{}] as any,
      }),
    ).rejects.toMatchObject({
      name: "ConfigurationError",
      code: "handoff_package_missing",
      message: expect.stringContaining("requires @theokit/sdk-handoff"),
    });
  });
});

describe("agent-helpers.ts — validateRehydratedAgent (Agent.resume)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "theokit-rehydrate-"));
    clearAgentRegistry();
  });

  afterEach(async () => {
    clearAgentRegistry();
    invalidateRegistryHydration();
    await rm(cwd, { recursive: true, force: true }).catch(() => {});
  });

  it("test_a_resume_whose_persisted_workspace_path_is_a_file_not_a_directory_is_refused_as_rehydration_failed", async () => {
    // Distinct from the "cwd no longer exists" case covered in
    // agent-registry-persistence.golden.test.ts (D21): here `stat()` SUCCEEDS
    // (something exists at the path) but it is not a directory — the
    // `info.isDirectory()` branch inside `validateRehydratedAgent`, which the
    // ENOENT-based D21 test never reaches.
    const original = await Agent.create({
      apiKey: "theo_test_rehydrate_not_a_dir",
      model: { id: "google/gemini-2.0-flash-001" },
      local: { cwd },
    });
    const agentId = original.agentId;
    await original.dispose();

    const siblingCwd = await mkdtemp(join(tmpdir(), "theokit-rehydrate-sibling-"));
    try {
      // Copy the registry so resume can locate the entry from siblingCwd —
      // `validateRehydratedAgent` still checks the ORIGINAL persisted cwd.
      const raw = await readFile(join(cwd, ".theokit", "agents", "registry.json"), "utf8");
      await mkdir(join(siblingCwd, ".theokit", "agents"), { recursive: true });
      await writeFile(join(siblingCwd, ".theokit", "agents", "registry.json"), raw);

      // Replace the original workspace directory with a plain FILE at the
      // exact same path: `stat` succeeds, `isDirectory()` is false.
      await rm(cwd, { recursive: true, force: true });
      await writeFile(cwd, "not a directory");

      clearAgentRegistry();
      invalidateRegistryHydration();

      await expect(Agent.resume(agentId, { local: { cwd: siblingCwd } })).rejects.toMatchObject({
        name: "UnknownAgentError",
        code: "agent_rehydration_failed",
        message: expect.stringContaining("missing or inaccessible"),
      });
    } finally {
      await rm(siblingCwd, { recursive: true, force: true });
    }
  });
});
