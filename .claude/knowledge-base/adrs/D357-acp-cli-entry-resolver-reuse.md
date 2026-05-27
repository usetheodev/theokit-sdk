# D357 — `theokit acp` CLI verb reuses `theokit dev` entry resolver

- **Status:** Accepted
- **Date:** 2026-05-26
- **Plan:** `acp-server-adapter-plan` (Phase 0)

## Context

`theokit dev` (`packages/cli/src/dev/entry-resolver.ts`) already resolves `src/index.ts` or `package.main` and dynamically imports the default export. ACP needs the same: resolve entry → import → use default export as the agent factory.

## Decision

`theokit acp` shares the entry resolver with `theokit dev`. The resolved module's default export is treated as either an `SDKAgent` instance or a factory `(sessionId) => Promise<SDKAgent>`.

## Rationale

Consistency — `dev` and `acp` are both "import + run agent" commands. Lower learning curve for users.

## Consequences

- Entry file MUST `export default` an `SDKAgent` instance or factory function.
- CLI wraps single-instance default exports into a factory automatically (D351 backward-compat).
- CJS/ESM module shape difference handled via `mod.default ?? mod` fallback (EC-4 / D-EC-4).
