# D299 — Service Account JSON file generation tooling deferred

**Date:** 2026-05-23
**Status:** Accepted

## Decision

v1 reads SA JSON via `GOOGLE_APPLICATION_CREDENTIALS` env (managed by the caller). SDK does not generate, rotate, or encrypt SA JSON files.

## Rationale

SA JSON management is a dev/ops responsibility — the user creates the key in the GCP Console. The SDK only consumes.

## Consequences

- Documented in README.
- Recommend Workload Identity Federation for apps outside GCP (eliminates the SA JSON file entirely).
