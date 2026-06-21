import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { type ModelCapabilities, resolveModelCapabilities } from "../src/models.js";

/**
 * M2-4 — integration: the public `@theokit/sdk/models` capability resolver works
 * offline/sync and the subpath is declared so Node ESM can resolve it.
 */
describe("models wiring (M2-4)", () => {
  it("test_models_subpath_exports", () => {
    expect(typeof resolveModelCapabilities).toBe("function");
    const caps: ModelCapabilities = resolveModelCapabilities("openai/gpt-4o");
    expect(caps.maxContextTokens).toBeGreaterThan(4096);
  });

  it("test_resolver_is_pure_offline_sync", () => {
    // deterministic + synchronous (no Promise, no network)
    const a = resolveModelCapabilities("openrouter/openai/gpt-4o:free");
    const b = resolveModelCapabilities("openrouter/openai/gpt-4o:free");
    expect(a).toEqual(b);
    expect(a.maxContextTokens).toBe(128_000);
  });

  it("test_models_subpath_declared_in_package_json", () => {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { exports: Record<string, unknown> };
    expect(pkg.exports["./models"]).toBeDefined();
  });
});
