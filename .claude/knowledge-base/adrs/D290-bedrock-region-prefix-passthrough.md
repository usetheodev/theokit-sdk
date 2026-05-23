# D290 — Bedrock model IDs accept region prefix (`us.`, `eu.`, `apac.`, `jp.`, `global.`) pass-through

**Date:** 2026-05-23
**Status:** Accepted

## Decision

Profile accepts IDs in the format `bedrock/{regionPrefix}.anthropic.{model}-v{N}:{rev}`. Client strips `bedrock/` (D290+EC-13 routing convention) and passes the raw AWS id to the URL. The `inferRegionFromModelId` helper maps prefix → AWS region for baseUrl resolution.

## Rationale

AWS Bedrock uses the model id prefix for routing. `global.anthropic.claude-opus-4-7-v1` resolves cross-region; `us.anthropic.claude-opus-4-7-v1` forces US. The caller chooses; no fallback logic in v1.

## Consequences

- Caller responsibility to consult Bedrock inference-profile availability per region.
- No model id validation in v1 — pass-through.
- `global.` prefix routes via `bedrock-runtime.us-east-1.amazonaws.com` (AWS default entrypoint).
