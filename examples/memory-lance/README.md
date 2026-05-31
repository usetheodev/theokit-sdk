# memory-lance — `@usetheo/sdk` LanceDB backend example

> Ships with `@usetheo/sdk@1.4.0` (lancedb-backend-ship-v1-1 plan). Closes
> ADR D12 ("LanceDB deferred to v1.1") via fulfillment of D43.

## What this shows

How to opt into the **Lance backend** for `Memory.create` instead of the
default SQLite-vec. Lance scales to >100k embeddings with HNSW-grade
vector search — relevant when SQLite-vec p95 latency starts hurting
(typically above ~10k facts).

Two modes:

1. **Dry-run (default)** — `pnpm run`: prints what the real path would
   do, exits 0. No LLM call, no Lance install required. Honored by ADR
   D50 — example must work even without the optional dep.
2. **Real** — `LANCE_REAL=1 pnpm run` (with `OPENROUTER_API_KEY` set
   and `@lancedb/lancedb` peer dep installed): seeds 3 facts with real
   OpenRouter embeddings, runs semantic recall, asserts a non-empty hit.

## Setup (real mode)

```bash
# 1. Install the peer deps (NOT bundled in @usetheo/sdk — opt-in).
pnpm add @lancedb/lancedb apache-arrow@^18.1.0

# 2. Get a free OpenRouter key at https://openrouter.ai/keys and copy
#    .env.example to .env. Fill OPENROUTER_API_KEY and LANCE_REAL=1.
cp .env.example .env
# Edit .env

# 3. Run.
pnpm run
```

Expected output:

```
=== @usetheo/sdk Lance backend example — REAL MODE ===
[1/4] Opening Lance index with real embedder...
[2/4] Seeding 3 synthetic facts...
[3/4] Recalling via semantic search...
      Got 3 hits. Top match:
        score=0.6XX
        snippet="LanceDB is a columnar vector database..."
[4/4] Closing index...
=== SUCCESS — Lance E2E validated with real LLM + real Lance. ===
```

## Gotchas

### Native binding prebuilds (ADR D43 consequences)

`@lancedb/lancedb` ships prebuilt binaries for:
- `linux-x64-gnu`
- `darwin-arm64`
- `darwin-x64`
- `win32-x64-msvc`

**Not covered:** Alpine/musl Linux, ARM-Linux. On those platforms the
peer install attempts a source build via `node-gyp` and fails without
toolchain. **Workaround:** stay on SQLite default (omit `backend: "lance"`).

### Bundler externalization (consumers of SDK)

If your consumer app bundles `@usetheo/sdk` (Next.js, Vite, webpack,
rollup), you MUST externalize `@lancedb/lancedb`:

- **Next.js:**
  ```js
  // next.config.js
  experimental: { serverComponentsExternalPackages: ["@lancedb/lancedb"] }
  ```
- **Vite:**
  ```js
  // vite.config.js
  optimizeDeps: { exclude: ["@lancedb/lancedb"] },
  ssr: { external: ["@lancedb/lancedb"] }
  ```
- **webpack/rollup:** add to `externals` array.

Without this, the bundler tries to process the `.node` binding and
crashes at build time.

### apache-arrow peer pin

`@lancedb/lancedb@0.30.0` requires `apache-arrow >=15.0.0 <=18.1.0`.
If your app already pins a newer `apache-arrow`, you'll see an
`unmet peer` warning — downgrade to `^18.1.0` or accept the warning
(Lance still works at v21 in practice, but it's not officially supported).

## When to use Lance vs SQLite

| Scale | Recommended backend | Why |
|---|---|---|
| < 1k facts | SQLite-vec (default) | Zero deps, fast startup |
| 1k–10k facts | SQLite-vec (default) | Still under p95 threshold |
| 10k–100k facts | Lance (opt-in) | SQLite-vec p95 > 100ms; Lance HNSW wins |
| > 100k facts | Lance (recommended) | Columnar storage + vector indices designed for this |

See `.claude/knowledge-base/benchmarks/memory-backends-2026-05-31.md`
in the SDK repo for the numerical methodology behind these thresholds.

## Migration SQLite → Lance

If you already have an SQLite memory index and want to migrate:

```bash
# Built-in CLI (shipped with @usetheo/sdk).
npx theokit-migrate-memory --from sqlite --to lance
```

See ADR D44 for migration design + `migrate-sqlite-to-lance.ts` for
implementation. Dry-run is the default — no destructive writes without
`--confirm`.
