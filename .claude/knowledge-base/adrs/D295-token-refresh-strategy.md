# D295 — Token refresh strategy: Bedrock caches, Vertex calls `getAccessToken` per request

**Date:** 2026-05-23
**Status:** Accepted

## Decision

- **Bedrock:** if the caller provides a token via env, SDK uses it directly (no cache, no refresh). If the optional `@aws/bedrock-token-generator` is installed, SDK caches the token for 1.5h (75% of the generator's 2h internal max) and refreshes on demand.
- **Vertex:** SDK calls `auth.getAccessToken()` per request via `google-auth-library`. The library handles internal caching (~50min refresh by default).

## Rationale

Bedrock long-term tokens don't need refresh; short-term tokens from the generator work fine with simple caching. Vertex always issues 1h OAuth tokens — delegate refresh to the official library.

## Consequences

- Bedrock test stubs `tokenGenerator()` returning different tokens across rotations.
- Vertex test stubs `auth.getAccessToken()` returning sequenced tokens.
- No mid-stream refresh: token expiration during a long stream (>1.5h Bedrock or >1h Vertex) results in a 401 — caller restarts the request.
