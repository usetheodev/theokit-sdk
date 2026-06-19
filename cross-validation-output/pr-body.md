## Release: develop → main (Changesets)

Merging this PR triggers `.github/workflows/release.yml` (`changesets/action@v1`) which versions each package from the pending changesets and publishes to npm. **2 changesets pending** → `@theokit/sdk` **minor** bump.

### Highlights (`[Unreleased]`)

**Added**
- **M0 foundation — expose existing internal primitives** (plan `m0-foundation-expose-primitives`): `isTransientError(err)`, `safeFilenameForId(id)`, `@theokit/sdk/concurrency` (`createSemaphore` + `mapWithConcurrency`), `@theokit/sdk/retry` (`withRetry`), `openSqliteResilient` — battle-tested plumbing now reusable instead of re-implemented.
- **`defineProvider(profile)` custom-provider factory** (plan `dev-friendly-custom-provider`): register any OpenAI-/Anthropic-compatible endpoint (Groq, Together, Fireworks, a private gateway) via `Agent.create({ model: { id: "myprov/model" }, plugins: [defineProvider(profile)] })`. New `docs.md` section + `examples/custom-provider/`.

**Fixed**
- **Custom `model-provider` plugins were silently dropped** — the public `Plugin { kind: "model-provider" }` variant was aggregated but never registered with the router (no-stubs-no-mocks-no-wired violation). Now wired end-to-end.
- CI release-pipeline + arch-review internal cleanup (Groups A–D), build-ordering, provenance/auth fixes.

### Quality
- Per-feature `/review` verdicts: M0 `READY_TO_MERGE` (5 agents), dev-friendly-custom-provider `READY_TO_MERGE` (3 agents).
- Pre-push gates GREEN: G8 LoC budget, bundle budget (sdk 78%), jscpd duplication.
- Audit: `knowledge-base/reviews/dev-friendly-custom-provider-review-2026-06-19.md`.

> Note: full `pnpm test` on a machine off the pinned Node (`.nvmrc` 22.12+) shows pre-existing environmental failures (better-sqlite3 NODE_MODULE_VERSION ABI + `globalThis.crypto` undefined) — unrelated to these commits (proven via baseline). CI runs Node 22.
