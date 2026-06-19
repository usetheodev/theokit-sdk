/**
 * Regression cover for the production caller of the model-provider wiring.
 *
 * `resolveRunProvider` is the seam `buildLoopInputs` uses on every real run; it
 * MUST register plugin-contributed provider profiles before the prefix-inference
 * lookup, else `model: { id: "myprov/model" }` would not resolve. Without this
 * test, deleting the `registerPluginProviderProfiles` call would pass every
 * other suite (the integration test exercises the helper directly, not the
 * caller).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineProvider } from "../../../src/index.js";
import { PluginManager } from "../../../src/internal/plugins/manager.js";
import {
  _resetBuiltinsRegistered,
  registerBuiltins,
} from "../../../src/internal/providers/builtin/index.js";
import {
  _resetProvidersForTests,
  getProviderProfile,
} from "../../../src/internal/providers/registry.js";
import type { ProviderProfile } from "../../../src/internal/providers/types.js";
import type { CreateRealLocalRunOptions } from "../../../src/internal/runtime/local-agent/real-local-run.js";
import {
  _resetPluginProviderAnnounce,
  resolveRunProvider,
} from "../../../src/internal/runtime/local-agent/real-local-run.js";

const customProfile: ProviderProfile = {
  name: "custom-llm",
  apiMode: "chat_completions",
  envVars: ["CUSTOM_LLM_API_KEY"],
  authType: "none",
  baseUrl: "https://api.custom-llm.test/v1",
  fallbackModels: ["custom-llm/default"],
};

function optionsWith(
  pluginManager: PluginManager | undefined,
  modelId: string | undefined,
): CreateRealLocalRunOptions {
  return {
    model: modelId === undefined ? undefined : { id: modelId },
    agentOptions: {},
    ...(pluginManager !== undefined ? { pluginManager } : {}),
  } as unknown as CreateRealLocalRunOptions;
}

describe("resolveRunProvider — model-provider plugin wiring (caller)", () => {
  beforeEach(() => {
    _resetProvidersForTests();
    _resetBuiltinsRegistered();
    _resetPluginProviderAnnounce();
    registerBuiltins();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers a plugin provider so the prefix selects it as primary", async () => {
    const mgr = new PluginManager();
    await mgr.initialize([defineProvider(customProfile)]);

    const { primary, effectiveModelId } = resolveRunProvider(
      optionsWith(mgr, "custom-llm/default"),
    );

    // Caller invoked the bridge → registry now resolves the custom provider.
    expect(getProviderProfile("custom-llm")).toBeDefined();
    // Prefix inference picked the now-registered plugin provider.
    expect(primary).toBe("custom-llm");
    expect(effectiveModelId).toBe("default");
  });

  it("emits a one-shot observability line when plugin providers are registered", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const mgr = new PluginManager();
    await mgr.initialize([defineProvider(customProfile)]);

    resolveRunProvider(optionsWith(mgr, "custom-llm/default"));
    resolveRunProvider(optionsWith(mgr, "custom-llm/default")); // second run

    const lines = stderr.mock.calls
      .map((c) => String(c[0]))
      .filter((l) => l.includes("registered") && l.includes("plugin provider profile"));
    expect(lines).toHaveLength(1); // one-shot per process, not per run
    expect(lines[0]).toContain("custom-llm");
  });

  it("no plugin manager → registers nothing and does not throw", () => {
    const { primary } = resolveRunProvider(optionsWith(undefined, undefined));
    expect(getProviderProfile("custom-llm")).toBeUndefined();
    expect(typeof primary).toBe("string"); // falls back to env detection / default
  });
});
