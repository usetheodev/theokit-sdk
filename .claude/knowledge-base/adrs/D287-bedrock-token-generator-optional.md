# D287 — `@aws/bedrock-token-generator` is an optional peer dep (auto-refresh)

**Date:** 2026-05-23
**Status:** Accepted

## Decision

Callers who want auto-refresh of short-term tokens install `@aws/bedrock-token-generator` (~97KB). SDK detects via `createRequire` lazy load (D34/D42 pattern). Without the package, SDK reads `AWS_BEARER_TOKEN_BEDROCK` directly.

## Rationale

Short-term tokens last up to 12h — long enough for dev/tests without refresh. Production callers who want rotation pay +97KB. Keeps base SDK lean.

## Consequences

- Two documented paths: "set env" (zero peer dep) and "install token-generator" (auto-refresh).
- Tests mock both paths.
- Vercel Edge / Cloudflare Workers (no AWS profile chain) use the env path only.
