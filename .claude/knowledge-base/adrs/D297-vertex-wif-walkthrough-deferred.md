# D297 — Workload Identity Federation walkthrough deferred to v1.x

**Date:** 2026-05-23
**Status:** Accepted

## Decision

v1 documents only the default ADC chain (env → gcloud → metadata server). A WIF setup tutorial is deferred to v1.x.

## Rationale

WIF setup is GCP-side (Terraform / Console / `gcloud iam workload-identity-pools` commands), not SDK code. ADC + `google-auth-library` resolves WIF transparently when configured. Focused documentation covers the most common path.

## Consequences

- Enterprise users with AWS→GCP federation use the same code path (ADC resolves via WIF transparently).
- Only the walkthrough docs are deferred.
