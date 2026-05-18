/**
 * Public security namespace (T2.1, ADR D68).
 *
 * Today exposes one entry point: `Security.addPattern(re)`. Built-in
 * patterns (12 of them — OpenAI, Anthropic, GitHub PAT classic + fine,
 * GitLab, AWS, Google, Slack, Sentry, Stripe live + restricted) plus
 * the parametric `key=value` matcher always run; user patterns are
 * additive.
 *
 * Redaction is ON by default. Disable with `THEOKIT_REDACT_SECRETS=false`
 * (a warning is emitted on stderr so the operator knows the SDK process
 * is vulnerable). The env var is snapshotted at module init — runtime
 * mutation cannot disable it, defending against prompt injection that
 * tries to flip the flag mid-run.
 */

import { addPattern as _addPattern } from "./internal/security/index.js";

export class Security {
  private constructor() {}

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
