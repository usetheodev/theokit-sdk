---
"@theokit/sdk": patch
---

Security (#54) — harden child-process env scrubbing.

- The `inherit-scrubbed` denylist now also drops the highest-signal VALUE-embedded-secret conventions: connection strings that carry `user:password@` (`DATABASE_URL`, `REDIS_URL`, `MONGODB_URI`, `DB_URL`, …), plus `DSN`, `WEBHOOK`, `COOKIE`, and `CONNECTION_STRING`. Generic non-secret URLs (`PUBLIC_BASE_URL`, `API_URL`, `PGHOST`) are deliberately preserved. A denylist still cannot catch every value-embedded secret — policy `core` (allowlist) remains the fail-closed mode for untrusted children.
- Removed dead `validateCommand` / `SHELL_METACHARACTERS` from the sandbox base — a never-invoked "guard" that provided a false sense of protection.
- Added an end-to-end test proving `LocalSandbox.execute` scrubs secret-like host env vars from the real child process.
