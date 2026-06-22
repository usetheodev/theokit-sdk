---
"@theokit/sdk": minor
---

Eval harness (M6, Tema E): first-party SWE-bench-style primitives over the existing `Eval`/`Scorers`/`SandboxBackend` surface, with zero new runtime dependencies.

- `loadJsonl(path, { map? })` from `@theokit/sdk/eval` — generic JSONL dataset loader with line-numbered `JsonlParseError`; the dataset schema is the caller's via `map`.
- Durable batch: `Eval.run({ persist: { path, key, resume }, classify })` flushes each row the instant it completes and resumes a crashed run by skipping already-persisted rows.
- `provisionRepo(sandbox, { repoUrl, ref, instanceId })` + `RepoProvisionError` — portable git clone+checkout over `SandboxBackend.execute`.
- `Scorers.verifyGate({ failToPass, passToPass })` — grades a patch by test exit-code via the sandbox; `EvalRowResult.artifact` carries `{ diff, applies }`.
