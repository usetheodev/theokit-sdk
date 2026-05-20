/**
 * Public security namespace (T2.1, ADR D68).
 *
 * Two entry points:
 *
 * - `Security.redact(text, opts?)` — apply the canonical redactor to
 *   arbitrary text. Useful when a consumer app (or example) writes its
 *   own logs / metrics / paste-share artifacts that the SDK's wired
 *   sinks (error metadata, telemetry, transcript, migration) don't
 *   cover.
 * - `Security.addPattern(re)` — register a custom credential pattern
 *   on top of the 12 builtins (OpenAI, Anthropic, GitHub PAT classic +
 *   fine, GitLab, AWS, Google, Slack, Sentry, Stripe live + restricted)
 *   plus the parametric `key=value` + `Bearer <token>` matchers.
 *
 * Redaction is ON by default. Disable with `THEOKIT_REDACT_SECRETS=false`
 * (a warning is emitted on stderr so the operator knows the SDK process
 * is vulnerable). The env var is snapshotted at module init — runtime
 * mutation cannot disable it, defending against prompt injection that
 * tries to flip the flag mid-run.
 */

import {
  addPattern as _addPattern,
  redactSecrets as _redactSecrets,
} from "./internal/security/index.js";

export class Security {
  private constructor() {}

  /**
   * Redact known credential patterns from `text` and return the masked
   * string. Use this at any consumer output boundary the SDK does not
   * directly own (custom stdout loggers, app-level metrics, debug-share
   * artifacts, etc.).
   *
   * Coerces non-strings (objects via JSON.stringify, null/undefined → "").
   * Two-bucket masking: tokens shorter than 18 chars → `***`; longer
   * tokens preserve `prefix...suffix` for debuggability without revealing
   * the secret middle.
   *
   * @param text - The value to redact. Strings, objects, primitives all OK.
   * @param opts.codeFile - When `true`, skips the parametric `key=value`
   *   matcher so file content like `.env.example` placeholders is left
   *   intact. Built-in pattern matches still apply.
   *
   * @example
   * console.log(`[bot] received: ${Security.redact(userText)}`);
   * // → "[bot] received: please remember sk-abc...xyz1"
   */
  static redact(text: unknown, opts?: { codeFile?: boolean }): string {
    return _redactSecrets(text, opts);
  }

  /**
   * Register a custom redaction pattern. Additive — built-in patterns
   * (OpenAI, Anthropic, GitHub PAT, AWS, etc.) cannot be removed.
   *
   * @param re - RegExp with `/g` flag. Throws if `/g` is missing
   *             (without /g, only first match is replaced and the rest
   *             leaks).
   *
   * Process-global mutable state. The SDK is designed for single-tenant
   * processes (Theo PaaS user runtime, local CLI). Multi-tenant
   * deployments running multiple SDK consumers in the same Node process
   * share this list — patterns added by tenant A apply to tenant B's
   * redactions. Acceptable for v1; future isolate-aware refactor would
   * thread patterns through a context if needed.
   *
   * @example
   * Security.addPattern(/MYORG-[A-Z0-9]{32}/g);
   * // → text containing "MYORG-AAAA...AAAA" now masks like a builtin.
   */
  static addPattern(re: RegExp): void {
    _addPattern(re);
  }
}
