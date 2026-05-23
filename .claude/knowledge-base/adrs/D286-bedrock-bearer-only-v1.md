# D286 — Bedrock uses Bearer token only in v1 (no SigV4)

**Date:** 2026-05-23
**Status:** Accepted

## Decision

Profile `bedrock` accepts Bearer token via env `AWS_BEARER_TOKEN_BEDROCK` or `Agent.create({ apiKey })`. No SigV4 signing, no `@aws-sdk/client-bedrock-runtime` dependency. Transport uses native `fetch`.

## Rationale

Bearer auth went GA in September 2025 (AWS official). Avoids the ~800KB `@aws-sdk/client-bedrock-runtime` + Smithy CJS tree. Short-term tokens (≤12h) and long-term tokens cover 100% of v1 use cases.

## Consequences

- Customers in SigV4-only environments (IAM role only, no Bearer permission) wait for v1.x.
- Token rotation is the caller's responsibility unless they opt into `@aws/bedrock-token-generator` (D287).
- Vercel Edge / Cloudflare Workers callers can use the SDK without AWS profile chain.
