# Rule: No Stubs, No Mocks, No Unwired Code

> **Status:** Inviolable. Established 2026-05-16. Applies to `packages/sdk/src/**` (production code only — tests under `packages/sdk/tests/` are exempt for mocks/stubs of external services).

## What this rule forbids

### 1. Stubs in production
Code that exists in the public API or runtime path but throws `not_implemented` (or any equivalent like `TODO`, `FIXME: implement`, `throw new Error("not implemented yet")`) is **forbidden**. If a feature is reachable from `Agent.create()`, `Cron.create()`, `Memory.*`, or any exported namespace, it must work end-to-end.

**Examples of violations:**
- `ConfigurationError(code: "adapter_not_implemented")` thrown from an adapter listed in a public catalog (`MEMORY_EMBEDDING_ADAPTERS`, etc.).
- `ConfigurationError(code: "memory_backend_not_implemented")` thrown from a backend selectable via public config (`{ backend: "lancedb" }`).
- `throw new UnsupportedRunOperationError(...)` for a feature documented in `docs.md` as available.
- Comments like `// TODO: implement in Phase X.1`, `// deferred to next iteration`, `// stub for now`.

**Allowed exceptions:**
- `UnsupportedRunOperationError` for genuinely runtime-incompatible operations (e.g., `downloadArtifact()` on a `LocalAgent` — the local runtime *cannot* serve artifacts; this is a constraint, not a stub).
- Internal `fixture-mode` paths used exclusively when no real API key is configured — these are deliberate test seams, not user-facing.

### 2. Mocks in production code
Files under `packages/sdk/src/` must not contain the words `Mock`, `Fake`, or `Stub` as exported names. Mocks live in `tests/` only.

**Examples of violations:**
- `MockEmbeddingProvider` exported from `src/internal/...`.
- `FakeLLMClient` instantiated from production runtime.
- `StubAdapter` (used by stub embedding providers — see rule 1) — these must be removed when their backing feature ships.

**Allowed exceptions:**
- Test fixtures under `packages/sdk/tests/fixtures/` or inline in `*.test.ts`.
- `fixture-mode.ts` / fixture responders explicitly gated by `shouldUseRealLocalRuntime()` returning `false`.

### 3. Unwired code (no caller, no runtime path)
Every exported class, function, or catalog entry in `packages/sdk/src/` must have at least one **real caller** reachable from the public API surface (`Agent`, `Cron`, `Memory`, `Theokit`). Code that exists but is never invoked at runtime is **forbidden**.

**Examples of violations:**
- A class registered in a catalog (`MEMORY_EMBEDDING_ADAPTERS[provider]`) but never actually constructed by any code path.
- A public type exported from `index.ts` with zero references in the SDK code or examples.
- A feature flag / config option (`memory.activeRecall.queryMode: "full"`) that exists in the type but is not branched on at runtime.
- A "Phase X" module that has tests but no production caller (the tests don't count as wiring).

**Allowed exceptions:**
- Public types intentionally exported for consumer use (verified via examples or docs.md).
- Plug-in interfaces explicitly designed for third-party implementation (must be documented in `docs.md` and have at least one real implementation shipped).

## Detection checklist

Run before declaring any feature "done":

```bash
# 1. Stubs that throw _not_implemented
grep -rn "not_implemented\|not.implemented" packages/sdk/src/

# 2. TODO / FIXME / "deferred to Phase" markers
grep -rn "TODO\|FIXME\|deferred to Phase\|stub for now\|placeholder" packages/sdk/src/

# 3. Mock/Fake/Stub identifiers in production
grep -rn "\bMock\|\bFake\|\bStub" packages/sdk/src/

# 4. Catalog entries — for each entry, confirm at least one real caller
grep -rn "MEMORY_EMBEDDING_ADAPTERS\|INDEX_BACKENDS" packages/sdk/src/

# 5. Public exports never referenced internally — use knip
NODE_OPTIONS="--max-old-space-size=8192" pnpm quality:dead
```

## What this rule enables

- A user can call any documented feature and it works. No "this is wired but the backend isn't implemented yet" surprise.
- Examples cannot rely on demo-only fallbacks to function — every example exercises real, reachable runtime paths.
- The SDK ships smaller: features not yet implemented are simply not in the API. The API can grow over time; it should never lie about what's available.

## Consequence for the memory-system-openclaw-parity plan

The plan was declared "complete" with the following violations (identified 2026-05-16):
- `voyage`, `deepinfra`, `lmstudio`, `google`, `bedrock` embedding adapters → catalog entries that throw `adapter_not_implemented`.
- `lancedb` backend → `IndexManager.open({ backend: "lancedb" })` throws `memory_backend_not_implemented`.
- Active Memory subagent LLM mode (Phase 7.1) → option surface exists but no LLM-mediated branch.
- Dreaming narrative LLM (Phase 9.1) → consolidation is deterministic only.
- `examples/memory-dreaming` → ships a local hash-embedding fallback because the real OpenAI/Mistral path requires creds the dogfood didn't run with.

These must be remediated: either by **shipping real implementations** or by **removing the surface from the public API** until shipped.

## How to invoke

When reviewing code, asking "is this done?", or before declaring a milestone complete, run:

```
/edge-case-plan {slug}
```

…and also the detection checklist above. If any violation is found, the milestone is **not** complete.
