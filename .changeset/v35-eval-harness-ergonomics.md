---
"@theokit/sdk": minor
---

V3-5 — make the eval-harness primitives usable without constructing a `SandboxBackend`. Both default to a `LocalSandbox` when no backend is passed; the explicit-sandbox path is unchanged.

- `provisionRepo` gains a 1-arg overload `provisionRepo(opts)` (sandbox defaults to a `LocalSandbox`, cloning into the process cwd's `<instanceId>`). The existing `provisionRepo(sandbox, opts)` form is unchanged. Pass an explicit `LocalSandbox({ workDir })` / Docker / E2B backend to control the workdir.
- `Scorers.verifyGate` — `VerifyGateOptions.sandbox` is now optional, defaulting to a `LocalSandbox` (workdir-independent: `verifyGate` always `cd`s to the explicit `repoDir`).

Lets a local execFile-based eval harness adopt these helpers without instantiating a backend it does not otherwise need. Zero new dependency (the default reuses the already-public `LocalSandbox`).
