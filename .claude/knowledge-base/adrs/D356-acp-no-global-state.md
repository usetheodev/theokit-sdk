# D356 — No global state in `@usetheo/acp`; every `serveAcp()` call is self-contained

- **Status:** Accepted
- **Date:** 2026-05-26
- **Plan:** `acp-server-adapter-plan` (Phase 0)

## Context

ACP servers are typically spawned one-per-workspace by the editor host. Multiple `theokit-acp` processes may run concurrently on the same machine (Zed + Cursor + headless CI).

## Decision

Every `serveAcp()` invocation gets its own `SessionStore` (Map), its own `AbortController`s, its own stdio binding. No module-level singletons.

## Rationale

Multi-process safety. Avoids cross-instance leakage if a consumer wraps `serveAcp` differently (e.g., embedding in tests).

## Consequences

- `SessionStore` is per-invocation, in-memory only.
- JSON-file session persistence is a v0.2 follow-up (mirrors D235 for workflows).
- Multiple concurrent `serveAcp` calls in the same process are safe but unusual.
