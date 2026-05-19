/**
 * Tests for lazy provider discovery (T3.4).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetDiscovery,
  discoverProviderPlugins,
} from "../../../src/internal/providers/discovery.js";
import {
  _resetProvidersForTests,
  getProviderProfile,
} from "../../../src/internal/providers/registry.js";

let tmpHome: string;
let originalHome: string | undefined;

beforeEach(() => {
  _resetDiscovery();
  _resetProvidersForTests();
  tmpHome = mkdtempSync(join(tmpdir(), "discovery-test-"));
  originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
});
afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  if (originalHome !== undefined) process.env.HOME = originalHome;
});

describe("discoverProviderPlugins (T3.4)", () => {
  it("idempotent — second call no-op", async () => {
    await discoverProviderPlugins();
    await discoverProviderPlugins();
    // No crash; nothing to assert beyond not throwing.
    expect(true).toBe(true);
  });

  it("no directory: no-op", async () => {
    await discoverProviderPlugins();
    expect(getProviderProfile("anything")).toBeUndefined();
  });

  it("EC-9: loads valid ESM plugin via file:// URL", async () => {
    const pluginDir = join(tmpHome, ".theokit", "plugins", "model-providers", "mistral-fake");
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, "index.mjs"),
      `export default {
  name: "mistral-fake",
  version: "1.0.0",
  kind: "model-provider",
  profile: {
    name: "mistral",
    apiMode: "chat_completions",
    envVars: ["MISTRAL_API_KEY"],
    authType: "api_key",
    baseUrl: "https://api.mistral.ai",
    fallbackModels: ["mistral-large"],
  },
};
`,
    );

    await discoverProviderPlugins();
    expect(getProviderProfile("mistral")?.apiMode).toBe("chat_completions");
  });

  it("skips broken plugin without crashing", async () => {
    const pluginDir = join(tmpHome, ".theokit", "plugins", "model-providers", "broken");
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, "index.mjs"), `throw new Error("syntax error in plugin");\n`);

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await discoverProviderPlugins();
    const calls = stderrSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(calls).toContain("failed to load");
    stderrSpy.mockRestore();
  });
});
