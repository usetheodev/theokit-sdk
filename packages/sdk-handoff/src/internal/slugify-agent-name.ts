/**
 * Turns an agent's display name into a tool-name-safe slug.
 *
 * Extracted because the identical function existed twice — `handoff.ts`'s `slugifyName` and
 * `tool-injector.ts`'s `slugify`, byte-identical apart from a parameter name — with no test
 * covering either. Two copies of one rule is the DRY violation `CLAUDE.md` § 12 describes: the
 * two would have drifted the moment one of them was adjusted.
 */

/**
 * Longest input the slug rules are applied to.
 *
 * The result is capped at 64 characters regardless, so nothing beyond this bound can survive;
 * bounding the INPUT is what keeps the cost of getting there linear in a value the caller
 * controls. CodeQL flags `/^_+|_+$/g` as `js/polynomial-redos` (alerts #10, #11).
 *
 * **Stated honestly: the quadratic cost could not be reproduced.** V8 resolves 100_000
 * underscores, with and without a trailing non-underscore, in under a millisecond — measured
 * 2026-08-22. So this bound is defence in depth against a regex engine that does not optimise
 * the shape, not a fix for an exploit anyone demonstrated. The duplication above is the defect
 * this change is really about.
 *
 * 1024 rather than 64: truncating to the output width before stripping the `agent-` prefix would
 * change results for real names, and a bound only has to be far below "unbounded" to do its job.
 */
const MAX_INPUT_LENGTH = 1024;

/**
 * @param candidate - raw agent name, id, or anything a caller supplied
 * @returns a slug of at most 64 characters, or `"anonymous"` when nothing survives
 */
export function slugifyAgentName(candidate: string): string {
  return (
    candidate
      .slice(0, MAX_INPUT_LENGTH)
      .replace(/^agent-/i, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64) || "anonymous"
  );
}
