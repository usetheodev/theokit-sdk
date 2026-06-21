import { parseModelId } from "./model-identifier.js";

/**
 * A UI-friendly model option — the shape a `<select>`/dropdown consumes.
 *
 * Public via `@theokit/sdk/models`.
 *
 * @public
 */
export interface ModelOption {
  /** The original model id (what you pass back to the SDK). */
  value: string;
  /** Best-effort human label (see {@link humanizeModelName}). */
  label: string;
  /** Provider from the slug prefix, or `undefined` when none. */
  provider: string | undefined;
}

/** Tokens rendered upper-case rather than title-case. */
const ACRONYMS = new Set(["gpt", "ai", "hd", "ui", "api", "sdk", "llm", "xl"]);

function prettyToken(token: string): string {
  if (ACRONYMS.has(token.toLowerCase())) return token.toUpperCase();
  return token.charAt(0).toUpperCase() + token.slice(1);
}

/**
 * Turn a model id into a best-effort human label: strip the routing/vendor
 * prefix to the core model segment, split on `-`/`_`/`.`/whitespace, title-case
 * each token (known acronyms upper-cased), and append an OpenRouter `:variant`
 * in parentheses. Deterministic, pure, dependency-free.
 *
 * Best-effort, NOT vendor-canonical: `"anthropic/claude-3-5-sonnet"` →
 * `"Claude 3 5 Sonnet"`. A UI wanting exact marketing names overrides per id.
 *
 * Public via `@theokit/sdk/models`.
 *
 * @public
 */
export function humanizeModelName(modelId: string): string {
  const { name } = parseModelId(modelId);
  if (name.length === 0) return "";
  const colon = name.indexOf(":");
  const base = colon >= 0 ? name.slice(0, colon) : name;
  const variant = colon >= 0 ? name.slice(colon + 1) : "";
  const lastSlash = base.lastIndexOf("/");
  const core = lastSlash >= 0 ? base.slice(lastSlash + 1) : base;
  const label = core
    .split(/[-_.\s]+/)
    .filter((t) => t.length > 0)
    .map(prettyToken)
    .join(" ");
  return variant.length > 0 ? `${label} (${variant})` : label;
}

/**
 * Build a {@link ModelOption} (`{ value, label, provider }`) for a model id —
 * a dropdown-ready entry composing {@link humanizeModelName} + `parseModelId`.
 *
 * Public via `@theokit/sdk/models`.
 *
 * @public
 */
export function toModelOption(modelId: string): ModelOption {
  return {
    value: modelId,
    label: humanizeModelName(modelId),
    provider: parseModelId(modelId).provider,
  };
}
