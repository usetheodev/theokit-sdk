# D255 — TTL per-category with default `1h`, exclusion regex for time-sensitive prompts

**Date:** 2026-05-22
**Status:** Accepted

## Decision

API: `ttl: { default: "1h", categories: { pricing: "15m", docs: "7d" }, exclude: /\b(today|now|current|weather|stock)\b/i }`. Default 1h. Exclusion regex marks queries to NEVER cache.

## Rationale

Category-aware paper (arxiv 2510.26835) proves fixed TTL is anti-pattern. Real-time queries need short TTL; docs need long. Exclusion regex avoids cache poisoning on time-sensitive prompts without complicating the API.

## Consequences

- v1 ships `default` + `exclude` (regex). `categories` deferred (requires per-prompt tagging from caller).
- Tests cover expiration.
- Documenting exclusion as safer default for FAQ-style apps.
