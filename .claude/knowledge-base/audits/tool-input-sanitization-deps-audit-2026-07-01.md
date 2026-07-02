# Deps Audit: tool-input-sanitization

**Date:** 2026-07-01
**Mode:** plan-bound:tool-input-sanitization
**Verdict:** PASS
**Hard caps triggered:** [] (none)

## Summary
- Ecosystems detected: npm
- Total deps audited: 1 new (`jsonrepair`), 1 existing reused (`zod`)
- Vulnerabilities found: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 0 LOW
- Outdated: 0 (plan pins `^3.13.2`; registry latest `3.14.1` is within the caret range — compatible, not outdated)
- Allowlist hits: 0
- Auditor coverage: { osv.dev API query: ran (empty result = no vulns), npm view: ran; osv-scanner CLI: available but N/A for a not-yet-installed dep — the OSV registry query is authoritative for a NEW dep }

## Vulnerabilities (sorted by severity)

(none) — OSV query `POST https://api.osv.dev/v1/query {package: jsonrepair@3.13.2, npm}` returned `{}` (no advisories). jsonrepair@3.13.2 confirmed present on the registry; not deprecated.

## Outdated (non-vulnerable)

- npm: `jsonrepair` plan-pin `^3.13.2` → registry latest `3.14.1` (MINOR). NOT flagged — `^3.13.2` already accepts `3.14.1`; the range is current.

## Plan validation (Mode 2)

| Plan dep | Section | Manifest match | Audit clean? | Rule 9 OK? | Verdict |
|---|---|---|---|---|---|
| `jsonrepair` | NEW | n/a (to add) | yes (0 CVE at 3.13.2; 0 transitive deps) | yes (hand-roll + `json5` + `best-effort-json-parser` evaluated & rejected) | OK |
| `zod` | Existing | yes (`^4.0.0` in package.json dependencies) | yes | n/a | OK |

## Supply-chain note

`jsonrepair` declares **zero runtime dependencies** (`npm view jsonrepair dependencies` → empty) — a minimal, self-contained transitive tree. Combined with lazy-loading behind the opt-in `repairJson` flag (ADR D4), the added attack surface is minimal and inert for consumers who never enable JSON repair.

## Recommended next steps

1. No manifest change required yet — `jsonrepair` is added during `/implement` T1.1 (with lazy `createRequire` load).
2. Proceed to `/plan-confidence`.
