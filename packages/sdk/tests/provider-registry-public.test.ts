import { describe, expect, it } from "vitest";

import { getProviderProfile, listProviders } from "../src/providers.js";

/**
 * The provider registry was `@internal`, so only the SDK could see which providers exist.
 *
 * It lives on a sub-entry rather than the barrel: exporting it from `index.ts` pulled the whole
 * provider graph into the barrel's module load and broke an unrelated cron test, which is the
 * same reason `auth`, `compaction` and `models` are sub-entries here.
 *
 * `theokit` therefore kept its own list — three entries, hand-copied, against the SDK's 46 — and an
 * agent asking for `ollama/…` routed nowhere the framework recognised. Duplicating a table nothing
 * forces to agree is what produced usetheokit/theokit#326; the fix is one registry, read by both.
 */
describe("the provider registry is public", () => {
  it("lists the builtins without the caller having to create an agent first", () => {
    const names = listProviders().map((p) => p.name);

    expect(names).toContain("anthropic");
    expect(names).toContain("openai");
    expect(names).toContain("openrouter");
    expect(names.length).toBeGreaterThan(20);
  });

  it("includes local providers, which need no credential", () => {
    for (const name of ["ollama", "lmstudio", "llamacpp"]) {
      const profile = getProviderProfile(name);
      expect(profile, name).toBeDefined();
      expect(profile?.authType, name).toBe("none");
    }
  });

  it("resolves an alias to its canonical profile", () => {
    expect(getProviderProfile("lm-studio")?.name).toBe("lmstudio");
  });

  it("returns undefined for a provider nobody registered", () => {
    expect(getProviderProfile("acme-not-a-provider")).toBeUndefined();
  });
});
