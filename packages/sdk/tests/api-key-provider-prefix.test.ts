import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as authBarrel from "../src/auth/index.js";
import { providerFromApiKeyPrefix } from "../src/internal/auth/api-key-prefix.js";

/**
 * "Which provider issued this key?" — the primitive, made reachable.
 *
 * The SDK already answered this, in `internal/local-agent/real-local-run-provider.ts`, marked
 * `@internal` and exported from no entry point. A measured consumer needs the same answer at
 * login (`opts.provider ?? inferProvider(key)`) and, unable to reach it, wrote its own. A
 * capability that exists and cannot be imported costs exactly what an absent one costs.
 *
 * Two things separate this from a straight re-export of the internal helper:
 *
 *  1. **Longest prefix wins, by construction.** The internal version iterates a hand-ordered
 *     array, and is correct today only because `sk-or-` and `sk-ant-` happen to be written above
 *     `sk-`. Order-as-convention breaks the first time someone appends a longer prefix or sorts
 *     the list — silently, resolving an Anthropic key to OpenAI. The consumer's own copy sorts by
 *     length; so does this.
 *  2. **No provider-profile gate.** That gate belongs to the local-run path, which will not use a
 *     provider it cannot construct. A caller asking "whose key is this?" at login has no profile
 *     registered yet, and returning `undefined` there would answer a question nobody asked.
 */
describe("providerFromApiKeyPrefix", () => {
  it("infers_each_known_provider", () => {
    expect(providerFromApiKeyPrefix("sk-or-v1-abc")).toBe("openrouter");
    expect(providerFromApiKeyPrefix("sk-ant-api03-abc")).toBe("anthropic");
    expect(providerFromApiKeyPrefix("sk-proj-abc")).toBe("openai");
  });

  it("the_longest_matching_prefix_wins", () => {
    // `sk-ant-…` also starts with `sk-`. Shortest-match-first would call an Anthropic key OpenAI
    // and send it to the wrong endpoint — a remote 401 whose message says nothing about prefixes.
    expect(providerFromApiKeyPrefix("sk-ant-api03-abc")).not.toBe("openai");
    expect(providerFromApiKeyPrefix("sk-or-v1-abc")).not.toBe("openai");
  });

  it("ordering_does_not_depend_on_declaration_order", () => {
    // The property, not the current table: whatever the entries are, the answer for a key must be
    // the provider with the LONGEST matching prefix. Asserted by construction — every prefix the
    // module knows is checked against every other, so a future entry cannot reintroduce the bug.
    const knownKeys = ["sk-or-v1-x", "sk-ant-api03-x", "sk-proj-x"];
    for (const key of knownKeys) {
      const answer = providerFromApiKeyPrefix(key);
      expect(answer, `no provider inferred for ${key}`).toBeDefined();
    }
    // A key matching two prefixes resolves to the more specific one.
    expect(providerFromApiKeyPrefix("sk-ant-x")).toBe("anthropic");
  });

  it("an_unknown_or_empty_key_infers_nothing", () => {
    // Negative cases. `undefined` means "cannot tell", never a guess — a wrong guess here picks
    // the wrong endpoint for a real credential.
    expect(providerFromApiKeyPrefix("gsk_groq_style_key")).toBeUndefined();
    expect(providerFromApiKeyPrefix("")).toBeUndefined();
    expect(providerFromApiKeyPrefix(undefined)).toBeUndefined();
    expect(providerFromApiKeyPrefix("   ")).toBeUndefined();
  });

  it("is_reachable_from_the_public_auth_entry", () => {
    // The whole point. Reachability is the fix; the function already existed.
    expect(
      (authBarrel as Record<string, unknown>).providerFromApiKeyPrefix,
      "@theokit/sdk/auth does not export it — the capability stays unreachable",
    ).toBe(providerFromApiKeyPrefix);
  });
});

/**
 * Every runtime export of `@theokit/sdk/auth` has a TYPE declaration.
 *
 * `tsconfig.base.json` sets `stripInternal: true`, and TypeScript matches that tag anywhere in an
 * attached JSDoc — prose included. A docblock that merely NAMES the tag while explaining something
 * deletes the declaration it sits above. That is how `providerFromApiKeyPrefix` shipped at runtime
 * and could not be imported with types (#283): the comment explaining the fix reintroduced the
 * defect the fix existed to close.
 *
 * A grep for the tag would be the obvious guard and the wrong one — it forbids the word instead of
 * the outcome. This asserts the OUTCOME: whatever the barrel exports at runtime, the `.d.ts`
 * declares.
 */
describe("auth entry — runtime exports are typed", () => {
  it("every_runtime_export_appears_in_the_declaration", async (ctx) => {
    const dts = join(process.cwd(), "dist", "auth", "index.d.ts");
    if (!existsSync(dts)) {
      // Reported, never a silent pass: an unbuilt dist means this guard verified nothing. A warning
      // on stdout is not that report — CI shows it as a green test. `ctx.skip` names the missing
      // artefact in the line a reader actually looks at.
      ctx.skip(
        "dist/auth/index.d.ts absent — run `pnpm build` before this guard can verify anything",
      );
      return;
    }
    const declared = readFileSync(dts, "utf8");
    const runtime = Object.keys(await import("../src/auth/index.js"));

    const undeclared = runtime.filter((name) => !new RegExp(`\\b${name}\\b`).test(declared));
    expect(undeclared, "exported at runtime, absent from the .d.ts").toEqual([]);
  });
});
