# D413 — Matrix SDK = `matrix-js-sdk@^32`

- **Status:** Accepted
- **Date:** 2026-05-28
- **Plan:** `gateway-tier-1-expansion-plan`

## Decision

Single optional peer-dep `matrix-js-sdk@^32.0.0` (~2MB). Lazy-loaded.

## Rationale

Official Element / Matrix Foundation SDK. Only mature TS option. Others (`matrix-bot-sdk`) wrap this or are abandoned.

## Consequences

Heavy peer-dep; price of admission for federation support.
