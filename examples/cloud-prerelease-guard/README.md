# cloud-prerelease-guard

Demonstrates the `cloud_runtime_pre_release` typed error for non-fixture
keys hitting cloud-only methods.

## Run

```bash
pnpm install --ignore-workspace
cp .env.example .env
pnpm dev
```

## What it shows

Cloud runtime depends on Theo PaaS, currently pre-release. The SDK
explicitly refuses to silently degrade — it throws
`ConfigurationError(code: "cloud_runtime_pre_release")` for:

- `agent.listArtifacts()`
- `agent.downloadArtifact(path)`
- `Agent.getRun(runId, { runtime: "cloud" })`

…when called with a real (non-`theo_test_*`) API key. Fixture mode
(`theo_test_*` keys) keeps serving deterministic data.

## Why this matters

Per ADR D15/D16 + the no-stubs-no-mocks-no-wired rule, the SDK never
serves fixture content masquerading as real PaaS data when the caller
holds a real key. This example shows how to consume the explicit error.
