---
"@theokit/sdk": patch
---

Internal architecture cleanup (arch-review Groups A–D) — no public API or behavior change.

- **Group A:** widen the internal `agent-factory-registry` inversion seam from `create()` to a full `AgentFacadePort` (`create`/`prompt`/`get`/`resume`/`batch`); route `internal/{eval,scorers,cron}` through `getAgentFacade()` instead of importing the public `Agent` facade upward. A `internal-must-not-import-facade` dependency-cruiser rule now enforces the boundary. `cron.ts`/`eval.ts` gained an `import "./agent.js"` bootstrap (kept out of tree-shaking via the `sideEffects` allowlist) so the `@theokit/sdk/cron` and `@theokit/sdk/eval` sub-path entries still register the facade at load time.
- **Group B:** relocated the 17 loose `internal/runtime/*.ts` modules into cohesive sub-folders (`lifecycle/`, `validation/`, `concurrency/`, `tools/`, `config/`, plus folding `system-prompt.ts`/`yaml-frontmatter.ts` into existing dirs); removed the dead `internal/runtime/mcp-tools.ts`.
- **Group C:** removed the cargo-cult `TheoKitContainer` (was `@public` but never exported; `run()` discarded registered tools/workflows); the `multi-agent` template now uses `Agent.create()`.
- **Group D:** renamed `internal/errors/` → `internal/error-mappers/` (the directory holds only provider error-mappers, no error classes).

All changes are internal-only and behavior-preserving (full suite GREEN, `madge --circular` unchanged, depcruise clean). Consumers see no API or behavior difference.
