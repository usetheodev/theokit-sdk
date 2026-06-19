# Review — dev-friendly-custom-provider (2026-06-19)

**Verdict: READY_TO_MERGE**
**Commits:** `7d53632` (feature) + `4181528` (review follow-ups) on `develop`.
**Plan:** `knowledge-base/plans/dev-friendly-custom-provider-plan.md`

## Cycle summary

- **Discover:** deep code read found the 3 originally-proposed "dev-friendly gaps" were mostly already solved — composition (`createSquad`/`Workflow`/`a2a/subagent`/`@theokit/sdk-handoff`) and context-compaction (`CompressionConfig` public) need no work. The ONE genuine gap: custom-provider registration via the public Plugin protocol was **half-wired** — `PluginManager` aggregated `providerProfiles` but nothing registered them (`registerProvider(` had zero call sites outside `internal/providers/`), so a `kind: "model-provider"` plugin was silently dropped (a `no-stubs-no-mocks-no-wired.md` violation). Plus no `defineProvider` factory (Rule 9), no docs, no example.
- **Plan → Implement (TDD):** RED → GREEN on `defineProvider` factory + the wiring fix + observability + docs + example.
- **Review:** 3 independent fresh-eyes agents. First two flagged HIGH (caller untested), MEDIUM (pillar-c metric), LOW (edge cases). All resolved in `4181528`. Final consolidation: READY_TO_MERGE.

## Findings resolved

| Sev | Finding | Resolution |
|---|---|---|
| HIGH | Production caller (`real-local-run`) untested — deleting the wiring wouldn't fail any test | Extracted `resolveRunProvider(options)` (@internal, SRP) + `resolve-run-provider.test.ts` asserts the prefix resolves to the plugin provider |
| MEDIUM | Wiring-triad pillar (c) missing | One-shot stderr `registered N plugin provider profile(s)` + test (fires once/process) |
| LOW | Edge cases | empty list (count 0), multiple providers, alias resolution |

## Gates

- Targeted vitest: 4 files / 23 tests GREEN · knip clean (zero dead code) · `tsc --noEmit` exit 0 · biome clean.
- No secrets · no Co-Authored-By trailer · branch `develop` · changeset present (`.changeset/dev-friendly-custom-provider.md`).
- Pre-existing ENVIRONMENTAL failures (better-sqlite3 NODE_MODULE_VERSION ABI mismatch + `globalThis.crypto` undefined on non-pinned Node) are unrelated — proven via baseline stash (credential-pool fails identically without this change). Fix is `nvm use` per CLAUDE.md "Native bindings discipline".

## DoD / Coverage Matrix (T1–T5) — all met

T1 custom provider routes via plugin ✓ · T2 `defineProvider` factory ✓ · T3 barrel export ✓ · T4 docs.md section ✓ · T5 worked example ✓ · no new dead code ✓.

## Honesty note

The cross-validation report's "75% / 4 high gaps" overstated the gap: `createSquad`/`CompressionConfig` were missed in the static pass. The only real dev-friendly gap was the half-wired provider path, now fixed.
