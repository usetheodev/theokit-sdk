# D149 — Adapter READMEs carry mandatory legal/security disclosures

**Date:** 2026-05-20
**Status:** Accepted

## Decision

Each adapter README must include a clearly labeled disclosure section
when the adapter wraps a provider with non-obvious legal or security
implications:

- **`@theokit/memory-honcho`** — `## License & Self-Hosting` section
  explaining Honcho server's AGPL-3.0 self-host implications. The
  `@honcho-ai/sdk` npm client is Apache-2.0, so consuming the SDK
  does not itself trigger AGPL; self-hosting the Honcho server does.
- **`@theokit/memory-mem0`** — `## Security Disclosure (CVSS 8.1)`
  section noting CVE-2026-XXXX (2026-04-17) injection vulnerability
  in OSS PGVector/MySQL/Neptune backends. Adapter cloud path is
  unaffected; advisory included for users who might also self-host.

Both sections are verified by README-grep tests (`tests/adapter.test.ts`)
that fail CI if the disclosure markers go missing.

## Rationale

Inviolable Rule #3 (extreme honesty) — hiding AGPL or CVSS exposure
puts downstream consumers at legal/security risk they didn't sign up
for. The CI grep test ensures we can't accidentally drop the
disclosure during a future README rewrite.

`@theokit/memory-supermemory` requires no disclosure: MIT, no known
high-severity issues.

## Consequences

- **Enables:** consumers make informed choices; auditors see explicit
  awareness; refactors can't silently remove disclosures.
- **Constrains:** README structure is partly load-bearing —
  contributors must keep the named sections present.
