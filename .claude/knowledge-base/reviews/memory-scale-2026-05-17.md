# Memory Scale Audit — 2026-05-17T18:16:58.668Z

Acceptance rubric (ADR D35):
- Ingest N facts across distinct themes → `clustersCreated >= target`
- Active Memory recall hit rate >= 75% across thematic queries

## Configuration

- Facts ingested: 12
- Themes: 4 (editor, programming language, tools, personal)
- Embedding provider: openrouter / openai/text-embedding-3-small
- Cluster target: 4
- Recall queries: 4

## Results

- Clusters created: **12** ✅ ≥4
- Facts before/after: 12 → 12
- Duplicates removed: 0
- Notes written: 1
- Recall hit rate: **4/4 = 100%** ✅

## Per-query recall

- [editor] q="What's my favorite code editor?" pattern=`/helix/i`
- [language] q="Which language do I prefer?" pattern=`/rust/i`
- [test runner] q="What test runner do I use?" pattern=`/vitest/i`
- [city] q="Where do I live?" pattern=`/são paulo|sao paulo|brazil/i`

## Verdict

**PASS** — clusters: 12/4, recall: 100%
