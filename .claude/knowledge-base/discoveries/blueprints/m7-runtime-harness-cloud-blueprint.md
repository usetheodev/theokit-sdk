# Blueprint: M7 Runtime ↔ Harness (cloud path, pre-release)

> **Version 1.0** — DISCOVER for M7. The `Agent` cloud path is wired + tested; Theo PaaS is pre-release (no real staging endpoint). Per the DoD's explicit escape ("documented as contract-only if PaaS not ready"), M7 is a **contract-only validation + pre-release labeling** milestone — the code + contract exist and are green; the gap is docs.md labeling parity with the README.

**Slug:** `m7-runtime-harness-cloud`
**Generated:** 2026-07-03
**Repo:** `theokit-sdk` (Harness owns the cloud path).

## Finding 1 — The cloud path is IMPLEMENTED and TESTED (no code gap)

- **`cloudPayload` contract** (`CloudAgentPayload`, `internal/runtime/cloud/cloud-payload-types.ts:13`): locked `schemaVersion: "1.0"` (ADR D15). Serializer `serializeCloudAgentConfig` (`cloud-config-serializer.ts:33`) — deterministic (canonical JSON, EC-1), 1 MB guardrail (EC-7), secret-filtered (EC-2: apiKey/MCP-env/provider-creds never cross the wire). Carries the redacted run-reconstruction subset (repos, autoCreatePR, model, systemPrompt, skills, plugins, mcp, agents, providers, memory).
- **CREATE vs RUN split (correct by design):** `POST /v1/agents` (`agent-helpers.ts:165`) sends the FULL `cloud: options.cloud` verbatim at agent creation (incl. `envVars` secrets over TLS — contract-tested at `cloud-http-protocol.contract.test.ts:63-69`). `POST /v1/agents/{id}/runs` (`real-cloud-run.ts:142`) sends the REDACTED `cloudPayload` per run. So there is **no silent-drop of `CloudOptions` fields** — `env`/`workOnCurrentBranch`/`skipReviewerRequest`/`envVars`/`prUrl` reach PaaS via the CREATE body; the run payload correctly omits secrets. (My first read mistook the redacted run-subset for a gap — it is not.)
- **`bc-` auto-detection** (`internal/ids.ts:86` `isCloudAgentId`; `agent-helpers.ts:220`): resume/get route to `CloudAgent` vs `LocalAgent` by the id prefix / registry runtime.
- **Cloud-only guards** (`cloud-agent.ts`): `runUntil`/`fork`/`runToCompletion`/`streamToCompletion`/`usePersonality`/`send(task)` all throw `UnsupportedRunOperationError` with explicit pre-release messages. `listArtifacts`/`downloadArtifact` return fixture data or throw `cloud_runtime_pre_release` for non-fixture keys.
- **Tests green:** cloud contract + golden tests pass (shape, determinism, secret filtering, HTTP protocol, bc- detection, prerelease guards) against a local HTTP stub — NOT a real PaaS.

## Finding 2 — DoD #1 is "contract-only" (PaaS pre-release, no real staging)

The `cloudPayload` contract is validated by the golden/contract tests against a
**local stub** (`startLocalHttpServer` / `startPaaSStub`), not a live Theo PaaS —
which is pre-release (root `CLAUDE.md` 3.49/4.0). The DoD explicitly allows this:
"**documented as contract-only if PaaS not ready**." M7 therefore records the
contract-only status + the existing test evidence; a real-staging validation is
deferred to PaaS availability.

## Finding 3 — DoD #2 gap: docs.md under-labels cloud-only features (README is fine)

- **README** has a clear `## Cloud runtime — pre-release` section (README.md:621-623): "depends on Theo PaaS, currently pre-release … Cloud APIs below describe the contract for when PaaS reaches general availability." ✓
- **docs.md** — the canonical API contract — labels ONLY `artifacts` as pre-release (`docs.md:3201`). The cloud **Overview** (docs.md:16-24) presents local + cloud as co-equal with NO pre-release caveat; `cloud.envVars` (docs.md:~91), `git` metadata on results (docs.md:427), and `autoCreatePR` (docs.md:1282) are described as working with no cloud-only/pre-release label. The SDK `CLAUDE.md` requires: "If a feature is cloud-only (artifacts, autoCreatePR, envVars, git metadata on results), say so explicitly." → **the M7 code deliverable is docs.md labeling parity.**

## Finding 4 — DoD #3: no GA claim (already honest)

`public-copy-lint` is clean on docs.md + README (0 banned framings). No unqualified
"generally available" / "production-ready" cloud claim exists; README:623 is the
correct honest framing ("contract for when PaaS reaches general availability").
M7 verifies this holds after the labeling edits.

## Coverage Corner 1 — Integration tests
Existing cloud contract + golden tests are the DoD #1 evidence (validate the
cloudPayload shape/determinism/secret-filtering/HTTP protocol against a stub). M7
adds no new runtime code, so no new tests — it re-runs these as the regression gate
and asserts they stay green after doc edits.

## Coverage Corner 2 — Dependencies
None. Docs-only milestone.

## Coverage Corner 3 — Tools
`public-copy-lint.sh` (banned-framing gate); the cloud golden/contract test suite.

## Coverage Corner 4 — Techniques
Contract-first documentation: describe the cloud contract as the shape PaaS will
consume when it ships, under an explicit pre-release banner — never claim GA.

## ADRs

### ADR-1 — M7 ships as docs labeling + contract-only status, NOT new cloud code
The cloud path + `cloudPayload` contract are already implemented + tested; adding
speculative cloud code before PaaS exists is YAGNI (parsimony ladder rung 1). M7's
honest deliverable is docs.md pre-release labeling parity with the README + a
documented contract-only status. **Rejected:** wiring a real PaaS staging call —
PaaS is pre-release, no endpoint exists; faking one would violate no-workarounds.

### ADR-2 — Label at the source (docs.md), not just the README
docs.md is the canonical API contract (SDK `CLAUDE.md`); the README summarizes it.
Cloud-only/pre-release status must be explicit in docs.md itself so a reader of the
contract is not misled. **Rejected:** relying on the README banner alone — a docs.md
reader would see cloud features as GA-working.

## Honest scope note
M7 is a small, honest, docs-labeling + contract-only-validation milestone (the
cloud path is already built + green). The DoD's "contract-only if PaaS not ready"
escape is the operative path. Evidence: cloud contract/golden tests stay green +
docs.md labels every cloud-only feature pre-release + `public-copy-lint` clean + no
GA claim. Real-PaaS validation is deferred to PaaS availability (external).

## Related
- SDK `CLAUDE.md § Pre-release honesty (cloud runtime)` — the labeling contract this milestone satisfies.
- `rules/public-copy.md` — banned framings (GA/production-ready).
- Ecosystem ROADMAP M7 DoD: #1 cloudPayload validated OR contract-only; #2 cloud-only features labeled pre-release in docs.md + README; #3 no GA claim.
