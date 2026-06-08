# Changelog — @theokit/sdk-memory

## [Unreleased]

### Changed (Phase 1 physical Stage 1 — iter 19, 2026-06-08)
- `createInMemoryMarkdownProvider` now implements the new optional
  `sync(handle)` port method (no-op for the in-process impl — facts
  are written synchronously to the Map at handler-call time; nothing
  to re-index post-run). Future LanceDB-backed impl will fire
  `IndexManager.sync()` here. Back-compat preserved: existing impls
  that omit `sync` are still valid per the optional-method spec.

## [0.1.0] — 2026-06-08

### Added
- Initial release. Consumes the `MemoryProvider` port from `@theokit/sdk@>=1.7.0`
  (SDK 2.0 Phase 1 / T1.6).
- `createInMemoryMarkdownProvider()` — first concrete impl. In-process
  fact store; LLM-facing `memory_remember` tool; `runActivePass()` emits
  `systemPromptAdditions` for recalled facts; full lifecycle compliance.

### Notes
- LanceDB / embeddings / circuit-breaker / dreaming-sweep deferred to future
  versions. This release ships the package foundation + a working impl so
  the SDK 2.0 cohort can publish (Phase 7).
- `peerDependency`: `@theokit/sdk >= 1.7.0` (where the port was shipped).
