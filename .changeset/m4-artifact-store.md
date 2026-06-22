---
"@theokit/sdk-tools": minor
---

M4-4 — generic session artifact store + opt-in plan-mode persistence (plan `m4-artifact-store`).

- `createSessionArtifactStore({ dir, idStrategy?, extension? })` → `{ write, read, has, list, path }`. A generic, id-keyed, atomic artifact store generalizing the per-run session-summary writer. `write(id, content)` persists `<dir>/<idStrategy(id)><extension>` via `replaceFileAtomic` and returns the path; `read` returns the content or `undefined` (never throws); `has`/`list` enumerate; `path(id)` is traversal-safe. Default `idStrategy` is `safeFilenameForId` (+ `safePathJoin`), so a `../escape` id can never write outside `dir`. Reads never throw; writes fail loud. Zero new dependencies.
- `createPlanModeTool({ artifactStore, artifactId? })` — a new OPT-IN overload whose async handler persists the submitted `plan` to the store on `exit` (returns `{ ok, mode, message, persisted, path }`). The zero-arg `createPlanModeTool()` is unchanged (synchronous handler, no disk). Only a non-empty `plan` on `exit` is persisted; `enter`/`status` never write.
