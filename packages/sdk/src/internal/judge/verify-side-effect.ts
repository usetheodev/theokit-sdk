/**
 * Side-effect verification (T2.3) — hallucination gate.
 *
 * When an agent CLAIMS to have done something (created a card, deleted a
 * file, wrote a memory), verify via independent oracle rather than
 * trusting the agent's narrative. Generic over claim type `T` and oracle
 * callback shape — caller adapts to its domain (Kanban, FS, DB).
 *
 * Mirrors the Hermes kanban v0.13 hallucination gate pattern (issue
 * #20232) where phantom card creations were caught by side-effect
 * verification rather than LLM-on-LLM cross-check.
 *
 * @internal
 */

export interface VerifyResult<T> {
  /** Claims for which `oracle(claim)` resolved to true. */
  verified: T[];
  /** Claims for which `oracle(claim)` resolved to false — phantom. */
  phantom: T[];
}

export async function verifyClaim<T>(
  claims: ReadonlyArray<T>,
  oracle: (claim: T) => Promise<boolean>,
): Promise<VerifyResult<T>> {
  const verified: T[] = [];
  const phantom: T[] = [];
  for (const claim of claims) {
    if (await oracle(claim)) {
      verified.push(claim);
    } else {
      phantom.push(claim);
    }
  }
  return { verified, phantom };
}
