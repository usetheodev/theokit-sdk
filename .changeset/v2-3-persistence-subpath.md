---
"@theokit/sdk": minor
---

Add the public `@theokit/sdk/persistence` sub-path (V2-3 — Theo Harness Capability Map). Promotes the consumer-grade persistence helpers from the semver-exempt `internal/persistence` to a STABLE, semver-protected surface: `appendJsonl` / `readJsonlIds` / `loadJsonl` (durable JSONL persist + resume), `replaceFileAtomic` / `atomicWriteText` / `atomicWriteJson` (audited atomic write — fsync, 0o600, crypto-random temp), `withFileLock` (cross-process lock), and `openSqliteResilient` / `applyWalWithFallback` / `isCorruptionError` (resilient SQLite bootstrap). Several were extracted from a real consumer (the SWE-bench eval harness); this sub-path lets consumers adopt them without coupling to `internal/`.
