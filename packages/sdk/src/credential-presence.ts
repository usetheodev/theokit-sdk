/**
 * Report whether a credential resolved — never what it is.
 *
 * Every agent product grows a "why can't I use this model?" surface: a doctor command, a status
 * panel, a startup diagnostic. Each needs to know whether a credential resolved, and each is one
 * careless line from printing it. The line is careless precisely because it is convenient — the
 * value is right there, and whoever is debugging a routing problem wants to see it.
 *
 * So presence-only is the DEFAULT here rather than each consumer's discipline. Discipline is what
 * every product has until the day it does not, and a leaked key is not a defect anyone can withdraw.
 *
 * ## Why a fingerprint and not a prefix
 *
 * A report has to be actionable: two people asking "is it the same key?" need something to compare.
 * The convenient answer — the first eight characters — is still the secret, and it is enough to
 * identify a key in a breach corpus. A hash is not.
 *
 * @public
 */

import { createHash } from "node:crypto";

/**
 * One provider's credential lookup, as the product resolved it.
 *
 * `value` is the secret itself. It is hashed and dropped inside `describeCredential` — it never
 * reaches the report, and nothing here stores it.
 *
 * @public
 */
export interface CredentialInput {
  /** The product's name for the provider. This module never knows one of its own. */
  readonly provider: string;
  /** The resolved secret, or `undefined`/empty when nothing resolved. */
  readonly value: string | undefined;
  /** Where it came from, in the product's vocabulary — `env`, `file`, `keychain`, `oauth`. */
  readonly source: string;
}

/**
 * A presence-only view of one credential, safe to print, log, or attach to a support bundle.
 *
 * `fingerprint` is the first eight hex characters of the SHA-256 of the trimmed secret: enough for
 * two people to agree they are holding the same key, and not a substring of it. It is absent
 * whenever `present` is false.
 *
 * @public
 */
export interface CredentialReport {
  readonly provider: string;
  readonly present: boolean;
  readonly source: string;
  /** Eight hex characters of a hash. Absent when no credential resolved. Never a prefix. */
  readonly fingerprint?: string;
}

/**
 * Turn a resolved credential into something you can show a user.
 *
 * The value is trimmed before the emptiness test, so `undefined`, `""` and whitespace all report
 * `present: false` with no fingerprint. That matters because an environment variable that expanded
 * to nothing arrives as an empty string, and calling that "present" sends whoever is debugging to
 * hunt for a routing bug instead of a missing secret.
 *
 * @returns a report safe to log, render and attach to a support bundle.
 * @public
 */
export function describeCredential(input: CredentialInput): CredentialReport {
  // Trimmed before the emptiness test: an unset variable read through a shell expansion arrives as
  // `""` or whitespace, and reporting that as present claims a working credential where there is
  // none — the same shape B-118 measured with an npm token resolving to empty.
  const secret = (input.value ?? "").trim();
  if (secret.length === 0) {
    return { provider: input.provider, present: false, source: input.source };
  }

  return {
    provider: input.provider,
    present: true,
    source: input.source,
    fingerprint: createHash("sha256").update(secret).digest("hex").slice(0, 8),
  };
}
