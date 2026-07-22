import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

/**
 * M47 — the trust gate for the dynamic provider-plugin loader. The fixture plugin's import writes a MARKER
 * file, so "blocked" is proven as NON-EVALUATION (the import never ran), not merely non-registration.
 */

let tmpHome: string;
let originalHome: string | undefined;
let marker: string;

function fixturePlugin(name: string): void {
  const dir = join(tmpHome, ".theokit", "plugins", "model-providers", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "index.mjs"),
    `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(marker)}, "EVALUATED"); // import-time side effect — the attack surface
export default {
  name: ${JSON.stringify(name)},
  version: "1.0.0",
  kind: "model-provider",
  profile: { name: ${JSON.stringify(name)}, apiMode: "chat_completions", envVars: [], authType: "api_key",
             baseUrl: "https://fixture.invalid/v1", fallbackModels: [${JSON.stringify(`${name}/m`)}] },
};
`,
  );
}

function trustFile(content: string): void {
  const dir = join(tmpHome, ".theokit", "plugins");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "trusted-providers.json"), content);
}

beforeEach(() => {
  _resetDiscovery();
  _resetProvidersForTests();
  tmpHome = mkdtempSync(join(tmpdir(), "discovery-trust-"));
  marker = join(tmpHome, "evaluated.marker");
  originalHome = process.env.HOME;
  process.env.HOME = tmpHome;
  delete process.env.THEOKIT_TRUSTED_PROVIDERS;
});

afterEach(() => {
  rmSync(tmpHome, { recursive: true, force: true });
  if (originalHome !== undefined) process.env.HOME = originalHome;
  delete process.env.THEOKIT_TRUSTED_PROVIDERS;
  vi.restoreAllMocks();
});

describe("M47 — dynamic-loader trust gate (fail-closed)", () => {
  it("an UNTRUSTED plugin is blocked BEFORE import — its code is never evaluated", async () => {
    fixturePlugin("evil-provider");
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await discoverProviderPlugins();
    expect(existsSync(marker)).toBe(false); // the import NEVER ran
    expect(getProviderProfile("evil-provider")).toBeUndefined();
    const warns = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(warns).toContain('"evil-provider" is present but NOT trusted');
    expect(warns).toContain("trusted-providers.json"); // actionable: names the file to edit
  });

  it("a TRUSTED plugin (file allowlist) loads and registers exactly as before", async () => {
    fixturePlugin("good-provider");
    trustFile(JSON.stringify(["good-provider"]));
    await discoverProviderPlugins();
    expect(existsSync(marker)).toBe(true);
    expect(getProviderProfile("good-provider")?.baseUrl).toBe("https://fixture.invalid/v1");
  });

  it("THEOKIT_TRUSTED_PROVIDERS env trusts additively (no file needed)", async () => {
    fixturePlugin("env-provider");
    process.env.THEOKIT_TRUSTED_PROVIDERS = "other, env-provider";
    await discoverProviderPlugins();
    expect(getProviderProfile("env-provider")).toBeDefined();
  });

  it("a MALFORMED trust file fails closed (nothing loads) with a WARN", async () => {
    fixturePlugin("some-provider");
    trustFile("{ not json !!");
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await discoverProviderPlugins();
    expect(existsSync(marker)).toBe(false);
    expect(getProviderProfile("some-provider")).toBeUndefined();
    const warns = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(warns).toContain("not valid JSON");
    expect(warns).toContain("fail-closed");
  });

  it("a NON-ARRAY trust file fails closed with a WARN", async () => {
    fixturePlugin("some-provider");
    trustFile(JSON.stringify({ trusted: ["some-provider"] })); // wrong shape
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await discoverProviderPlugins();
    expect(existsSync(marker)).toBe(false);
    const warns = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(warns).toContain("not a JSON array");
  });

  it("a MISSING trust file fails closed (quiet per-plugin WARN, no crash)", async () => {
    fixturePlugin("some-provider");
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await discoverProviderPlugins();
    expect(existsSync(marker)).toBe(false);
    expect(stderrSpy.mock.calls.map((c) => String(c[0])).join("")).toContain("NOT trusted");
  });
});
