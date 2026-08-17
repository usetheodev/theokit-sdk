#!/usr/bin/env node
// M44 — regenerate the per-model `models` blocks in provider-catalog.json from models.dev (maintenance-time
// ONLY; the runtime never fetches here). Sibling of refresh-pricing.mjs. Shape kept snake_case VERBATIM
// (ADR D1) so this script needs zero field renaming.
//
// Curated subset (ADR D5): each entry's fallbackModels + the SDK builtins' fallbackModels + every former
// EXACT-map key. Vendoring all of models.dev (~3.2MB) is deliberate bloat we reject.
//
// PARITY GUARANTEE (ADR — capabilities): for former EXACT-map models, the capability-relevant fields
// (tool_call / structured_output / cache_control / modalities-vision / limit) are written FROM the EXACT
// snapshot (tests/fixtures/exact-map-snapshot.json), with models.dev supplying cost/release_date as
// enrichment — so the catalog-backed resolver reproduces the old answers deterministically.
//
// Usage: node scripts/refresh-catalog.mjs [path-to-api.json]   (no arg → fetch https://models.dev/api.json)

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOG = join(HERE, "..", "src", "internal", "providers", "provider-catalog.json");
const SNAPSHOT = join(HERE, "..", "tests", "fixtures", "exact-map-snapshot.json");

// theokit catalog-entry id → models.dev provider id (Blueprint §6.7 — the explicit mapping table).
const ID_MAP = {
  "google-gemini": "google",
  bedrock: "amazon-bedrock",
  "amazon-bedrock": "amazon-bedrock",
  vertex: "google-vertex",
  together: "togetherai",
  fireworks: "fireworks-ai",
  zhipu: "zai",
};

// EXACT-map vendor prefix → theokit catalog-entry id (where the model block lives).
const VENDOR_TO_ENTRY = {
  openai: "openai",
  anthropic: "anthropic",
  google: "google-gemini",
  deepseek: "deepseek",
  qwen: "qwen",
  "z-ai": "zhipu",
};

// The SDK builtins' fallbackModels (maintenance-time copy — builtins are TS, unreachable from .mjs).
const BUILTIN_MODELS = {
  anthropic: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  openai: ["gpt-4o", "gpt-4o-mini"],
  "google-gemini": ["gemini-2.0-flash-001"],
  openrouter: [],
};

// Vendor aliases the index needs so capability lookups (vendor-keyed: google/…, z-ai/…) resolve.
const ALIAS_ADDITIONS = { "google-gemini": ["google"], zhipu: ["z-ai"] };

// M44 M6 — theokit-extension capability fields models.dev can never supply, for models NOT in the former
// EXACT map (the SDK's own builtin defaults). All current Anthropic models support prompt caching.
const CAPABILITY_OVERRIDES = {
  anthropic: {
    "claude-opus-4-7": { cache_control: true },
    "claude-sonnet-4-6": { cache_control: true },
    "claude-haiku-4-5-20251001": { cache_control: true },
  },
};

const DEPENDED_FIELDS = ["cost", "limit"]; // fail LOUD if models.dev removes/renames these (Blueprint §6.4)

function bare(modelId) {
  const i = modelId.lastIndexOf("/");
  return i >= 0 ? modelId.slice(i + 1) : modelId;
}

// PRE-EXISTING debt, exposed when M75 fixed the Biome config that used to abort before
// sweeping these files (a nested root under refactor/). It is not new code and was not touched
// by M75; refactoring SDK internals without review would trade a visible problem for a risky
// diff. Tracked in usetheodev/theokit-sdk#151.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: see the reason just above
function fromModelsDev(m) {
  const out = {};
  if (typeof m.name === "string") out.name = m.name;
  if (typeof m.release_date === "string") out.release_date = m.release_date;
  for (const k of ["attachment", "reasoning", "temperature", "tool_call", "structured_output"]) {
    if (typeof m[k] === "boolean") out[k] = m[k];
  }
  if (m.cost && typeof m.cost.input === "number" && typeof m.cost.output === "number") {
    out.cost = { input: m.cost.input, output: m.cost.output };
    if (typeof m.cost.cache_read === "number") out.cost.cache_read = m.cost.cache_read;
    if (typeof m.cost.cache_write === "number") out.cost.cache_write = m.cost.cache_write;
  }
  if (m.limit && typeof m.limit.context === "number") {
    out.limit = { context: m.limit.context };
    if (typeof m.limit.input === "number") out.limit.input = m.limit.input;
    if (typeof m.limit.output === "number") out.limit.output = m.limit.output;
  }
  if (m.modalities && Array.isArray(m.modalities.input)) {
    out.modalities = { input: m.modalities.input };
    if (Array.isArray(m.modalities.output)) out.modalities.output = m.modalities.output;
  }
  if (typeof m.status === "string") out.status = m.status;
  return out;
}

/** Overlay EXACT capability truth on a model block (parity guarantee). */
function overlayExact(block, caps) {
  block.tool_call = caps.supportsToolUse;
  block.structured_output = caps.supportsStructuredOutput;
  block.cache_control = caps.supportsCacheControl;
  block.modalities = {
    ...(block.modalities ?? {}),
    input: caps.supportsVision ? ["text", "image"] : ["text"],
  };
  block.limit = { context: caps.maxContextTokens, output: caps.maxOutputTokens };
  return block;
}

async function loadApi(arg) {
  if (arg) return JSON.parse(readFileSync(arg, "utf-8"));
  const res = await fetch("https://models.dev/api.json", { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`models.dev fetch failed: HTTP ${res.status}`);
  return await res.json();
}

const api = await loadApi(process.argv[2]);
const catalog = JSON.parse(readFileSync(CATALOG, "utf-8"));
const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf-8"));

// Sanity: fail LOUD on removed/renamed depended-on fields. Free/local models legitimately omit `cost`,
// so the probe scans broadly and fails only when NO model in the payload carries a depended-on field.
for (const f of DEPENDED_FIELDS) {
  const anyHasField = Object.values(api).some(
    (p) => p?.models && Object.values(p.models).some((m) => m && typeof m === "object" && f in m),
  );
  if (!anyHasField) {
    throw new Error(
      `models.dev schema drift: depended-on field "${f}" missing from ALL model entries`,
    );
  }
}

// Group former-EXACT keys by target entry.
const exactByEntry = {};
for (const [key, caps] of Object.entries(snapshot)) {
  const [vendor, ...rest] = key.split("/");
  const model = rest.join("/");
  if (!model) continue; // prefix-only keys (openrouter/, vertex/, bedrock/) are strip rules, not models
  const entryId = VENDOR_TO_ENTRY[vendor];
  if (!entryId) {
    process.stderr.write(`WARN: no entry mapping for EXACT vendor "${vendor}" (${key})\n`);
    continue;
  }
  exactByEntry[entryId] ??= {};
  exactByEntry[entryId][model] = caps;
}

let totalModels = 0;
for (const entry of catalog) {
  const mdId = ID_MAP[entry.id] ?? entry.id;
  const mdProvider = api[mdId];
  const targets = new Set([
    ...entry.fallbackModels.map(bare),
    ...(BUILTIN_MODELS[entry.id] ?? []),
    ...Object.keys(exactByEntry[entry.id] ?? {}),
  ]);
  if (targets.size === 0) continue;

  const models = {};
  for (const modelId of targets) {
    const md = mdProvider?.models?.[modelId];
    let block = md ? fromModelsDev(md) : {};
    const caps = exactByEntry[entry.id]?.[modelId];
    if (caps) block = overlayExact(block, caps); // parity truth for former EXACT keys
    const override = CAPABILITY_OVERRIDES[entry.id]?.[modelId];
    if (override) Object.assign(block, override); // theokit extensions models.dev cannot supply (M6)
    if (Object.keys(block).length === 0) {
      process.stderr.write(
        `WARN: no data for ${entry.id}/${modelId} (not in models.dev, not in EXACT)\n`,
      );
      continue;
    }
    models[modelId] = block;
  }
  if (Object.keys(models).length > 0) {
    entry.models = models;
    totalModels += Object.keys(models).length;
  }
  const add = ALIAS_ADDITIONS[entry.id];
  if (add) entry.aliases = [...new Set([...(entry.aliases ?? []), ...add])];
}

writeFileSync(CATALOG, `${JSON.stringify(catalog, null, 2)}\n`);
const size = readFileSync(CATALOG, "utf-8").length;
console.log(
  `enriched ${CATALOG}: ${totalModels} models across entries; ${(size / 1024).toFixed(1)}KB`,
);
