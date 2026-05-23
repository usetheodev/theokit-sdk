# D293 — Vertex `global` location forces baseUrl `aiplatform.googleapis.com` (no region prefix)

**Date:** 2026-05-23
**Status:** Accepted

## Decision

When `GOOGLE_CLOUD_LOCATION === "global"`, baseUrl is `https://aiplatform.googleapis.com/...` (not `https://global-aiplatform.googleapis.com/...`). Hardcoded in `resolveVertexBaseUrl`.

## Rationale

Known bug: `streamRawPredict` returns 404 at `global-aiplatform.googleapis.com` (cline#10287). The Anthropic docs document this workaround.

## Consequences

- One-line check in `resolveVertexBaseUrl`.
- Test covers both regional and global paths.
