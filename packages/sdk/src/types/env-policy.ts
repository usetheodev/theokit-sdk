/**
 * Owner: `sandbox/` (1 of 2 importers). Derived from the import graph, not
 * declared — `tests/lint/types-name-their-owner.test.ts` re-derives it.
 *
 * Child-process environment policy contract (#54).
 *
 * The DIP-correct home for the `EnvPolicy` contract type: the domain `types/`
 * layer owns the contract, and the application-layer implementation
 * (`internal/runtime/lifecycle/env-policy.ts`) re-exports it for back-compat
 * while owning the runtime logic (`resolveChildEnv`, secret patterns, …).
 *
 * Modes:
 *  - `inherit-scrubbed` (DEFAULT) — inherit all parent vars EXCEPT secret-like
 *    names (`*KEY*`, `*SECRET*`, `*TOKEN*`, `*PASSWORD*`, `*_AUTH*`). Non-breaking:
 *    existing spawns keep every non-secret var; only secrets stop leaking.
 *  - `core` — inherit ONLY a safe base allowlist (PATH/HOME/…); strongest scrub.
 *  - `all` — explicit opt-out: inherit everything, secrets included.
 *
 * @public
 */
export type EnvPolicy = "inherit-scrubbed" | "core" | "all";
