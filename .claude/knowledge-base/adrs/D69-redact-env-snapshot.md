# D69 — `THEOKIT_REDACT_SECRETS` env var snapshotted at module init

**Date:** 2026-05-18
**Status:** Accepted
**Related:** D68, D70, plan `secret-redaction-discipline-plan.md`

## Decision

`internal/security/redact.ts` reads `process.env.THEOKIT_REDACT_SECRETS`
exactly once, at module load:

```typescript
let REDACT_ENABLED: boolean = readEnvOnce();

function readEnvOnce(): boolean {
  const raw = process.env.THEOKIT_REDACT_SECRETS;
  if (raw === undefined) return true;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}
```

Subsequent mutations of `process.env.THEOKIT_REDACT_SECRETS` are
ignored. The `_resetForTests` helper can flip the flag for the duration
of a test, but production callers cannot.

## Rationale

Prompt-injection defense. Concrete attack:

1. Adversarial input gets the LLM to suggest a shell command like
   `export THEOKIT_REDACT_SECRETS=false` (visible in the user's logs).
2. The user accepts the suggestion (or the shell tool auto-runs it).
3. Subsequent `redactSecrets` calls become no-ops.
4. The next error from a provider echoes their key into telemetry, logs,
   transcripts.

By snapshotting at import time, the only way to disable redaction is
*before the SDK module loads* — outside the LLM's reach. Same defense
pattern as Hermes `redact.py:60-69`.

## Consequences

- Enables an invariant ("after process boot, redaction state is
  immutable from inside the agent loop").
- Constrains: tests that legitimately need to toggle the flag must
  import from `internal/security/_test-reset.ts` (or call
  `_resetForTests` directly) instead of mutating env.
- Constrains: hot-reload of the env var requires a process restart.
