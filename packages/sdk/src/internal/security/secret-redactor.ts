/**
 * `SecretRedactor` — stable interface for the canonical secret redaction
 * primitive (ADR D437, plan `arch-review-fixes-2026-06-06` T9.1).
 *
 * **Purpose:** the 2026-06-06 architecture audit flagged `sdk.internal.security`
 * as sitting in the Martin "Zone of Pain" — high afferent coupling (Ca=12)
 * combined with zero abstractness (A=0.000) yielding a Distance from Main
 * Sequence of D=0.923. The audit's recommendation was NOT a full refactor
 * (security primitives must stay concrete and stable per ADRs D68-D73), but
 * to introduce **one** stable abstraction so dependent modules can hold an
 * interface reference rather than the concrete function. This trades a tiny
 * amount of abstraction (A bump from 0.000 → ~0.05) for evolution capacity
 * without touching the implementation.
 *
 * **Structural-typing contract:** the canonical `redactSecrets` function
 * exported from `./redact.ts` satisfies this interface structurally — no
 * class wrapper is required. Consumers may hold a `SecretRedactor`-typed
 * reference like so:
 *
 * ```ts
 * import { redactSecrets } from "./redact.js";
 * import type { SecretRedactor } from "./secret-redactor.js";
 *
 * const redactor: SecretRedactor = { redact: redactSecrets };
 * console.log(redactor.redact("API_KEY=sk-proj-AAAA..."));
 * ```
 *
 * **Boundaries:**
 * - This file is types-only — TypeScript erases the interface at build time.
 *   Runtime exports are zero.
 * - The canonical implementation stays at `./redact.ts` (D68); this interface
 *   does NOT introduce a parallel implementation or a new entry point.
 * - The `value` parameter is `unknown` per the canonical signature; the opts
 *   slot of `redactSecrets` (`codeFile?: boolean`) is INTENTIONALLY omitted
 *   from this interface to keep the surface minimal and discourage callers
 *   from threading file-type semantics through arbitrary indirection chains.
 *   Callers that need the `codeFile` knob must reach for `redactSecrets`
 *   directly — they're already coupled to the implementation by definition.
 *
 * @internal — NOT part of the `@theokit/sdk` public API.
 */
export interface SecretRedactor {
  /**
   * Redact a value, returning a string with built-in credential patterns
   * masked. Null-ish inputs return the empty string. When redaction is
   * disabled via `THEOKIT_REDACT_SECRETS=0` (and the warning has fired —
   * see D70), this is a no-op coercion to string.
   */
  redact(value: unknown): string;
}
