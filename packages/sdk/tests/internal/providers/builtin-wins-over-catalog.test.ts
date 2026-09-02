/**
 * "What is provider X's baseUrl / envVars / authType / apiMode" has two homes, and the
 * one a caller reaches is the TypeScript builtin. This file makes that a checked fact.
 *
 * `registerBuiltins()` registers 19 first-party profiles and then calls
 * `registerCatalogProviders()`, which skips any entry whose id or alias is already
 * registered. So for every provider that exists in both places the catalog's CONFIG half
 * is dead — while its `models` half stays live, because `indexEntryModels` runs for every
 * entry regardless of registration. Half of each duplicated entry is load-bearing and half
 * is unreachable, and nothing compared the two: the exact condition under which duplicated
 * knowledge rots without anyone noticing.
 *
 * It already had. Measured 2026-09-01: NINE of the twins disagree, and in every case the
 * builtin is the deliberately-corrected one. `cohere`'s builtin docblock says the catalog
 * baseUrl is "doubly wrong" and the wrong value is still in the JSON; `bedrock` differs on
 * three fields at once, including `authType`; the `/v1` suffix differences are a path-join
 * convention the builtins own.
 *
 * WHY THIS IS A PRECEDENCE TEST AND NOT A SYNC TEST. The obvious remedy — make the two
 * agree — is not durable here: `provider-catalog.json` is VENDORED (`chore(catalog): M45 —
 * re-vendored models`, plus a `refreshModelCatalog` path), so a hand-correction to its
 * config fields is undone by the next refresh. Asserting agreement would install a gate
 * that breaks on every upstream sync for a value nobody reads. What IS invariant, and what
 * this file pins, is that the builtin wins and the catalog's config never reaches a caller.
 *
 * The failure this catches: someone deletes a builtin, or moves `registerCatalogProviders()`
 * above the builtins, and a provider silently starts resolving to a stale vendored baseUrl.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

import { registerBuiltins } from "../../../src/internal/providers/builtin/index.js";
import { getProviderProfile } from "../../../src/internal/providers/registry.js";

/**
 * The nine measured disagreements, with the value the BUILTIN carries. Derived by
 * comparing every catalog entry against its builtin twin, not chosen by hand — a ceiling
 * nobody re-derives stops being a gate, which this audit has now filed three times.
 */
const BUILTIN_WINS: ReadonlyArray<{
  id: string;
  field: "baseUrl" | "authType" | "apiMode" | "envVars";
  builtin: string | readonly string[];
}> = [
  { id: "openai", field: "baseUrl", builtin: "https://api.openai.com" },
  { id: "anthropic", field: "baseUrl", builtin: "https://api.anthropic.com" },
  { id: "openrouter", field: "baseUrl", builtin: "https://openrouter.ai/api" },
  { id: "openrouter", field: "envVars", builtin: ["OPENROUTER_API_KEY", "OPENAI_API_KEY"] },
  { id: "ollama", field: "baseUrl", builtin: "http://localhost:11434" },
  { id: "ollama", field: "envVars", builtin: ["OLLAMA_API_KEY"] },
  { id: "lmstudio", field: "baseUrl", builtin: "http://localhost:1234" },
  { id: "lmstudio", field: "envVars", builtin: ["LMSTUDIO_API_KEY"] },
  { id: "llamacpp", field: "baseUrl", builtin: "http://localhost:8080" },
  { id: "llamacpp", field: "envVars", builtin: ["LLAMACPP_API_KEY"] },
  { id: "bedrock", field: "envVars", builtin: ["AWS_BEARER_TOKEN_BEDROCK"] },
  { id: "bedrock", field: "authType", builtin: "aws_bearer" },
  { id: "bedrock", field: "apiMode", builtin: "bedrock_anthropic" },
  { id: "vertex", field: "baseUrl", builtin: "https://us-central1-aiplatform.googleapis.com" },
  { id: "vertex", field: "apiMode", builtin: "anthropic_messages" },
  { id: "cohere", field: "baseUrl", builtin: "https://api.cohere.ai/compatibility/v1" },
  { id: "cohere", field: "envVars", builtin: ["COHERE_API_KEY", "CO_API_KEY"] },
];

/**
 * Every `id.field` where the RESOLVED profile and the vendored catalog entry disagree.
 *
 * Extracted from the drift case below rather than inlined: the loop-inside-a-loop plus the
 * two guards put that test at cognitive complexity 16 against a ceiling of 10, and the
 * honest response to a complexity gate is to split the function, not to suppress it.
 */
function disagreements(byId: Map<string, Record<string, unknown>>): string[] {
  const out: string[] = [];
  for (const [id, entry] of byId) {
    const resolved = getProviderProfile(id);
    if (resolved === undefined) continue;
    for (const field of COMPARED_FIELDS) {
      if (JSON.stringify(resolved[field]) !== JSON.stringify(entry[field]))
        out.push(`${id}.${field}`);
    }
  }
  return out;
}

const COMPARED_FIELDS = ["baseUrl", "authType", "apiMode", "envVars"] as const;

let catalogById: Map<string, Record<string, unknown>>;

beforeAll(() => {
  registerBuiltins();
  const raw = JSON.parse(
    readFileSync("src/internal/providers/provider-catalog.json", "utf8"),
  ) as Array<Record<string, unknown>>;
  catalogById = new Map(raw.map((e) => [String(e.id), e]));
});

describe("the TypeScript builtin is what a caller resolves, never the vendored catalog", () => {
  it.each(
    BUILTIN_WINS.map((r) => [`${r.id}.${r.field}`, r] as const),
  )("%s resolves to the builtin value", (_label, { id, field, builtin }) => {
    const resolved = getProviderProfile(id);
    expect(resolved, `provider "${id}" must be registered`).toBeDefined();
    expect(
      resolved?.[field],
      `"${id}".${field} resolved to the CATALOG value. Either a builtin was deleted or ` +
        "registerCatalogProviders() now runs before the builtins — a provider is silently " +
        "using a stale vendored value.",
    ).toEqual(builtin);
  });

  it.each(
    BUILTIN_WINS.map((r) => [`${r.id}.${r.field}`, r] as const),
  )("%s still differs from the catalog copy", (_label, { id, field }) => {
    // ANTI-VACUITY GUARD. Every case above passes trivially if the catalog happens to
    // agree — the assertion would be comparing the builtin to itself and would keep
    // passing after the precedence broke. This half asserts the two are STILL different,
    // so the cases above are known to be discriminating. If an upstream re-vendor makes
    // one agree, this fails and the row is removed deliberately rather than rotting into
    // a check that proves nothing.
    const entry = catalogById.get(id);
    expect(entry, `catalog must still carry a twin for "${id}"`).toBeDefined();
    const resolved = getProviderProfile(id);
    expect(
      JSON.stringify(resolved?.[field]),
      `"${id}".${field} now AGREES with the catalog. Drop this row from BUILTIN_WINS — ` +
        "it no longer discriminates between the two sources.",
    ).not.toBe(JSON.stringify(entry?.[field]));
  });

  it("no NEW twin has drifted since the nine were measured", () => {
    const known = new Set(BUILTIN_WINS.map((r) => `${r.id}.${r.field}`));
    const surprises = disagreements(catalogById).filter((k) => !known.has(k));
    expect(
      surprises,
      "A builtin and its vendored catalog twin have drifted apart on a field that was in " +
        "agreement when this was measured. Decide which is right, then record it in " +
        "BUILTIN_WINS with the reason — silent drift between two homes for one fact is " +
        "what this file exists to stop.",
    ).toEqual([]);
  });
});
