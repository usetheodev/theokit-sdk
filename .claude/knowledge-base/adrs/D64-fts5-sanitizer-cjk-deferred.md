# ADR D64 — FTS5 6-step sanitizer + CJK auto-detection (trigram routing deferred)

Date: 2026-05-18
Status: Accepted
Plan: [persistence-state-hardening](../plans/persistence-state-hardening-plan.md)

## Decision

`internal/persistence/fts5-sanitize.ts` exports two helpers:

1. **`sanitizeFts5Query(query: string): string`** — 6-step port of Hermes'
   `_sanitize_fts5_query` (`hermes_state.py:1797-1847`):

   1. preserve `"quoted phrases"` via control-char sentinels (U+0001 + index
      + U+0002 — chosen because they don't match Step 5's auto-quote regex,
      preserving idempotence on second sanitize pass)
   2. strip unmatched specials (`[`, `]`, `{`, `}`, `(`, `)`, `"`, `^`)
   3. collapse repeated asterisks (`***` → `*`)
   4. strip dangling boolean operators (`AND`, `OR`, `NOT`) at start/end
   5. auto-quote identifier-shaped tokens with `-`, `.`, or `_` so FTS5
      treats them as phrases instead of boolean conjunctions
   6. restore preserved phrases

2. **`containsCjk(text: string): boolean`** — returns true if `text` contains
   any character in the main CJK Unicode ranges (Hiragana, Katakana, CJK
   Unified, Hangul, etc.). Coverage matches Hermes' v0.12 coarse detection.

Empty-string output post-sanitize is short-circuited at each call site
(EC-3 fix) so `MATCH ''` is never executed (some SQLite versions error on
empty queries).

CJK **trigram routing** (separate FTS5 table with `tokenize='trigram'`) is
deferred to v1.4 — adds a new index requiring a schema bump.

## Rationale

- Without the sanitizer, queries like `error-code`, `auth_token`, `v2.3.1`
  either return nothing (FTS5 splits on `-`/`_`/`.` into boolean AND) or
  throw `SQLITE_ERROR: fts5: syntax error`. Hermes shipped and fixed 10
  related bugs over v0.4 → v0.12 — the sanitizer is the consolidated
  defense.
- The sentinel-with-control-char design is essential for idempotence:
  using `__PHRASE_N__` would re-trigger Step 5 on second sanitize pass and
  double-quote the placeholder.
- CJK trigram routing is a useful but bounded improvement. Deferring it
  keeps this plan focused on the safety surface (no crashes, correct
  hyphenated search) and saves the schema bump for v1.4.

## Consequences

- `index-manager.ts:ftsSearch` calls `sanitizeFts5Query(query)` then checks
  `.length === 0` before preparing the SQL.
- The previous local `sanitizeFtsQuery` (coarse per-token quote-everything)
  is removed; the new helper handles the cases more precisely.
- CJK queries (3+ chars) currently return empty results gracefully — they
  pass through the sanitizer but never match in the default tokenizer.
  Trigram support lands in v1.4.
- Tests for hyphenated/dotted/underscored search retrieval (no fallback to
  empty) are added in T5.1 and the integration E2E.
