# voice / rag maturity probe (T0.2 — resolves Q1)

Date: 2026-06-18
Plan: monorepo-cohesion-split

## Method

Grepped `packages/sdk/src/{voice,rag}` for internal coupling, `packages/sdk/package.json` for sub-path exports, `packages/sdk/src/index.ts` for barrel re-exports, `packages/sdk/tsup.config.ts` for build entries, and `packages/sdk/tests` for dedicated tests.

## Findings

| Module | LoC | Exported? | tsup entry? | Barrel re-export? | Internal sdk coupling | Dedicated tests |
|---|---|---|---|---|---|---|
| `rag` | 514 (5 ts) | **yes** — `./rag` (`package.json:161`) | yes — `rag/index` (`tsup.config.ts:16`) | no | **none** — only relative (`./reranker.js`, `./retriever.js`, `./text-splitter.js`, `./types.js`) | effectively none — the 24 grep hits were substring false-positives ("stoRAGe", "fRAGment", "inteGRAtion"); no `tests/rag/**` dir |
| `voice` | 258 (3 ts) | **no** | no | no | **none** — only relative (`./openai-realtime.js`, `./types.js`) | 1 — `tests/voice/openai-realtime.test.ts` |

Key insight: **both are fully self-contained leaves** (zero imports from `@theokit/sdk` internals). Extraction therefore requires NO import rewiring — the relative imports stay valid inside a new standalone package. `voice` is currently **not even exported** (unreachable by consumers); `rag` is a real public sub-path.

## Verdict (per ADR D434)

- **`rag` → EXTRACT** to standalone `theokit-rag` (`@theokit/rag`). Rationale: it is a public exported feature, self-contained, clean to lift. Deleting would silently drop a shipped capability; extraction preserves it with its own cadence.
- **`voice` → EXTRACT** to standalone `theokit-voice` (`@theokit/voice`). Rationale: self-contained and carries a real OpenAI-realtime test. Although currently unexported (effectively dead public surface), extracting to its own package both removes it from the Harness AND makes it reachable as an opt-in package — strictly better than deletion. If the team prefers, deletion is the cheap fallback (no consumer depends on it today).

Both extractions are subtree-of-a-package lifts (`packages/sdk/src/{rag,voice}` live inside the `@theokit/sdk` package, not as standalone packages today), so Phase 5 scaffolds a fresh `package.json` + `tsconfig` + `tsup.config` around the lifted `src/` rather than moving an existing manifest.

## Source commit counts (EC-5 history-equality baseline)

di 20 · di-agent 15 · orm 9 · gateway 14 · gateway-telegram 6 · react 11 · skills-google-workspace 6 (rag/voice live under packages/sdk history — measured at lift time on the `src/{rag,voice}` paths).
