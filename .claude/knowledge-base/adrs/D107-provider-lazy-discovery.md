# D107 — Provider discovery is lazy + last-writer-wins (with WARN)

**Date:** 2026-05-19
**Status:** Accepted
**Related:** D105, D106

## Decision

Builtin providers register eagerly on first router call
(`registerBuiltins()`). User plugins in `~/.theokit/plugins/
model-providers/<name>/index.{js,mjs}` are lazy-scanned by
`discoverProviderPlugins()` (idempotent per process).

Override (user re-registers `anthropic`) logs to stderr — last writer
wins. EC-5: alias collision between two providers also logs WARN.

EC-9: Dynamic `import()` uses `pathToFileURL(absPath).href` so Node 22
ESM resolves absolute paths correctly.

## Rationale

Eager builtins means `Agent.create({ provider: "anthropic" })` works
immediately. Lazy user discovery means startup cost only paid when
needed.

Override with WARN: user might intentionally customize Anthropic
profile (self-hosted proxy URL); silent override would mask mistakes.

## Consequences

- **Enables:** customize built-in providers without fork; install
  third-party providers via npm + drop in `~/.theokit/plugins/`.
- **Constrains:** WARN in stderr (operators must monitor logs to
  catch unintended overrides).
- **EC-14 (documented):** 100+ plugin dirs sequential = lento;
  acceptable for typical N ≤ 10.
- **EC-15 (documented):** Plugin with `kind: "general"` in
  `/model-providers/` dir silently skipped (kind-specific discovery).
