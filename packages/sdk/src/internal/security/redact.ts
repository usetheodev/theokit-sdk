/**
 * Canonical secret redaction module (ADRs D68-D73).
 *
 * Single source of truth for credential pattern masking across the SDK.
 * Wired at output boundaries: `ErrorMetadata.raw` (mappers/shared.ts),
 * telemetry span attributes (telemetry/tracer.ts), transcript JSONL
 * appends (agent-session-store.ts), migration logger output
 * (memory/migrate-sqlite-to-lance.ts).
 *
 * - D68: central module, single source of truth (replaces 2 duplicates)
 * - D69: env snapshot at module init (prompt-injection defense)
 * - D70: ON by default, warn on opt-out
 * - D71: two-bucket masking — short fully masked, long preserves prefix+suffix
 * - D72: `codeFile` opt-out for legitimate prefix-shaped content
 * - D73: redact at OUTPUT boundaries, not at storage
 *
 * @internal
 */

// D69: env snapshot captured at module load. Subsequent mutations of
// process.env.THEOKIT_REDACT_SECRETS are ignored — defends against
// prompt injection that tries to disable redaction mid-run.
let REDACT_ENABLED: boolean = readEnvOnce();

function readEnvOnce(): boolean {
  const raw = process.env.THEOKIT_REDACT_SECRETS;
  if (raw === undefined) return true; // D70: default ON
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

// D70: warn once on opt-out so the user knows they're vulnerable.
let warnedOptOut = false;
if (!REDACT_ENABLED && !warnedOptOut) {
  process.stderr.write(
    "[theokit-sdk] Secret redaction is DISABLED via THEOKIT_REDACT_SECRETS. " +
      "Credentials may leak into errors, telemetry, logs, transcripts.\n",
  );
  warnedOptOut = true;
}

/**
 * Built-in credential patterns. Order matters — more specific prefixes
 * must come before generic ones (e.g., `sk-ant-` before `sk-`). Quantifiers
 * are all bounded `{n,m}` or applied to char classes — linear time, no ReDoS.
 *
 * @internal
 */
const BUILTIN_PATTERNS: readonly RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{10,}/g, //   Anthropic
  /sk-proj-[A-Za-z0-9_-]{10,}/g, //  OpenAI project key (must precede sk- generic)
  /sk-[A-Za-z0-9_-]{10,}/g, //       OpenAI / OpenRouter / DeepInfra. {10,} body floor —
  //   real keys are 40+ chars; 10-char floor still skips `sk-test` (4) and
  //   `sk-test-key` (8). codeFile mode protects placeholders/examples.
  /ghp_[A-Za-z0-9]{36}/g, //         GitHub PAT classic (exact length)
  /github_pat_[A-Za-z0-9_]{82}/g, // GitHub PAT fine-grained
  /glpat-[A-Za-z0-9_-]{20}/g, //     GitLab PAT
  /AKIA[A-Z0-9]{16}/g, //            AWS access key
  /AIza[A-Za-z0-9_-]{35}/g, //       Google API key
  /xox[bpasr]-[A-Za-z0-9-]{10,}/g, //Slack tokens
  /sntrys_[A-Za-z0-9]{40,}/g, //     Sentry user auth
  /sk_live_[A-Za-z0-9]{20,}/g, //    Stripe secret
  /rk_live_[A-Za-z0-9]{20,}/g, //    Stripe restricted
];

// `Bearer <token>` matched as its own first-class pattern so PARAM_PATTERN
// doesn't have to handle the unusual `Authorization: Bearer xxx` shape
// (no `:` or `=` between "Bearer" and the value — bare whitespace).
const BEARER_PATTERN = /\b(Bearer\s+)([A-Za-z0-9_\-.+/=]{8,})/g;

// Parametric: matches `key=value` and `key: value` (with optional quote
// between the key and the separator, to handle JSON: `"api_key": "..."`)
// in URLs, query strings, JSON-like bodies, HTTP headers. Captures the
// prefix so we keep it visible while masking the value.
//
// `authorization` deliberately excluded — BEARER_PATTERN handles the
// common `Authorization: Bearer xxx` shape. Including it here causes
// double-masking ("Authorization: *** ***") after Bearer fires.
const PARAM_PATTERN =
  /(\b(?:access_token|api_key|api-key|password|secret|x-api-key)\b["']?\s*[:=]\s*["']?)([A-Za-z0-9_\-.+/]+)/gi;

const _extraPatterns: RegExp[] = [];

/**
 * Add a user-defined redaction pattern. Additive — never removes builtins.
 * Throws if the regex lacks the `/g` flag (without `/g`, `.replace` only
 * substitutes the first match and the rest leaks).
 *
 * @internal — exposed publicly via `Security.addPattern` in `src/security.ts`.
 */
export function addPattern(re: RegExp): void {
  if (!re.global) {
    throw new Error("Security.addPattern: regex must have /g flag for replace-all semantics");
  }
  _extraPatterns.push(re);
}

/**
 * Two-bucket masking (D71):
 *   - tokens shorter than 18 chars → fully masked as `***`
 *   - tokens >= 18 chars → keep first 6 + `...` + last 4
 *
 * Rationale: long tokens are unique per-account; prefix+suffix preserves
 * debuggability without revealing the secret middle.
 *
 * @internal
 */
export function maskToken(token: string): string {
  if (token.length < 18) return "***";
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

/**
 * Redact known credential patterns from `text`. Default behavior masks
 * builtins + extras + parametric `key=value` sinks.
 *
 * With `{ codeFile: true }` (D72), skips PARAM_PATTERN to avoid mangling
 * `.env.example`, schema JSON, or test fixtures that legitimately contain
 * prefix-like strings.
 *
 * Returns the redacted string. Coerces non-strings via JSON.stringify;
 * EC-7 fix (edge-case review): wraps in try/catch so circular references
 * never propagate — returns sentinel `"[unredactable: circular]"`.
 *
 * @internal
 */
// Coerce arbitrary input to a string for redaction. Returns `null`
// sentinel when the value is null/undefined/non-stringifiable, so the
// caller can short-circuit with `""`. EC-7 fix: circular refs go through
// the try/catch and produce the sentinel marker, never throwing.
function coerceToString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    try {
      const s = JSON.stringify(value);
      return s === undefined ? null : s;
    } catch {
      return "[unredactable: circular]";
    }
  }
  return String(value);
}

export function redactSecrets(text: unknown, opts?: { codeFile?: boolean }): string {
  const coerced = coerceToString(text);
  if (coerced === null) return "";
  if (!REDACT_ENABLED) return coerced;

  let s = coerced;
  for (const re of BUILTIN_PATTERNS) {
    s = s.replace(re, (m) => maskToken(m));
  }
  for (const re of _extraPatterns) {
    s = s.replace(re, (m) => maskToken(m));
  }
  if (!opts?.codeFile) {
    // Bearer first (preserves "Bearer " prefix, masks the token after).
    // Must run before PARAM_PATTERN so the bare-whitespace shape doesn't
    // get mis-handled as a value.
    s = s.replace(BEARER_PATTERN, (_, prefix: string) => `${prefix}***`);
    s = s.replace(PARAM_PATTERN, (_, prefix: string) => `${prefix}***`);
  }
  return s;
}

/**
 * Test-only helper exported for `_test-reset.ts`. NOT included in the
 * `index.ts` barrel — vitest setup imports the dedicated module via
 * explicit path to discourage production callers.
 *
 * @internal
 */
export function _resetForTests(opts: { enabled?: boolean; clearExtras?: boolean }): void {
  if (opts.enabled !== undefined) REDACT_ENABLED = opts.enabled;
  if (opts.clearExtras === true) _extraPatterns.length = 0;
}
