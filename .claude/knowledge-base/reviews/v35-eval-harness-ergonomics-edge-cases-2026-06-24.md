# Edge Case Review — v35-eval-harness-ergonomics

Date: 2026-06-24
Tasks analyzed: 3 (T1.1 provisionRepo overload, T1.2 verifyGate optional sandbox, T2.1 docs/changeset)
Edge cases found: 4 (MUST FIX: 0, SHOULD TEST: 2, DOCUMENT: 2)

Boundaries: both functions take a `SandboxBackend` (now defaultable) + the only I/O is the sandbox's `execute` (git clone / test command). No concurrency, no shared state.

## MUST FIX

(none.)

## SHOULD TEST

### EC-1: the `provisionRepo` default-path test must not clone into the package working tree
- **Affected task:** T1.1
- **Family:** State
- **Suggested test:** `test_provisionRepo_defaults_to_local_sandbox` — the default `LocalSandbox` (no `workDir`) clones into `process.cwd()/<instanceId>`. The test MUST run in an isolated tmp cwd (set the sandbox's clone target via a tmp dir, OR `process.chdir(tmp)` in `beforeEach`/restore in `afterEach`, OR assert against a `file://` source repo created in a tmp dir) so it never pollutes the repo. Assert the 1-arg overload resolves a `repoDir` without an explicit sandbox.

### EC-2: `provisionRepo` arity discriminator vs an explicit `undefined` 2nd arg
- **Affected task:** T1.1
- **Family:** Input
- **Suggested test:** `test_provisionRepo_explicit_sandbox_unchanged` covers the 2-arg form; ALSO assert that a 1-arg call passing a non-`ProvisionRepoOptions` (e.g. a bare object missing `repoUrl`) throws the normal validation error — confirming the discriminator (`maybeOpts !== undefined`) routes a single arg to `opts` cleanly. `provisionRepo(sandbox, undefined)` was already invalid (opts required); no real caller does it.

## DOCUMENT

### EC-3: the cwd-workdir caveat applies to `provisionRepo` only, NOT `verifyGate`
- **Accepted risk / clarification:** `verifyGate` runs `cd <repoDir> && cmd` where `repoDir` is an EXPLICIT option — the default `LocalSandbox`'s workdir is irrelevant to it. So the "default clones into cwd" caveat (plan Drawback 1) is a `provisionRepo`-only concern. docs.md should state the default-workdir caveat under `provisionRepo`, and note `verifyGate`'s default is workdir-independent (it always `cd`s to the passed `repoDir`).

### EC-4: a fresh `LocalSandbox` is allocated per default call
- **Accepted risk:** negligible — `LocalSandbox` is a stateless execFile wrapper (plan Drawback 2). Explicit-sandbox callers allocate nothing new. No action.

## Summary

| Task | Edges found | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------|----------|-------------|----------|
| T1.1 | 2 | 0 | 2 (EC-1, EC-2) | 0 |
| T1.2 | 0 | 0 | 0 | 0 |
| T2.1 | 2 | 0 | 0 | 2 (EC-3, EC-4) |

**Verdict:** PLAN OK

Minimal, additive slice. The 2 SHOULD-TEST items are test-hygiene refinements to T1.1's existing TDD (isolated tmp cwd + discriminator assertion). EC-3 sharpens the docs wording (verifyGate's default is safe — no workdir dependency). No MUST FIX. Proceed to `/plan-confidence`.
