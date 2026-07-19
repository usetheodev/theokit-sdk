---
"@theokit/sdk": patch
---

fix(a2a): register the `Agent` facade on a process-global `Symbol.for` slot so `SubAgent` works across build entries (#142). Each public entry (`.`, `./a2a`, `./cron`, `./eval`, …) is bundled with `tsup splitting: false`, which inlines its own copy of the internal `agent-factory-registry` — a module-level `let` gave each copy a private registration slot, so a subagent invoked through `@theokit/sdk/a2a` read a slot the `.` entry (via `agent.ts`'s `setAgentFacade`) never set, throwing `internal: Agent facade not registered` even when the main entry was loaded first. The registry now stores the facade on `globalThis[Symbol.for("theokit.internal.runtime.agentFacade")]`, so all duplicated copies share ONE registration. Adds regression tests. No public API change.
