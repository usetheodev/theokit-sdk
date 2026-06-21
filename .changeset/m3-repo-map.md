---
"@theokit/sdk-tools": minor
---

M3-3 — repo-map / env-context builders (plan `m3-repo-map`).

`@theokit/sdk-tools` now exports two `node:fs`-only, char-bounded, **never-throw** string builders that orient an LLM coding agent in one call:

- `buildEnvContext(cwd)` — an `<env>` block: working directory, platform/arch, Node version, is-git (detected via the presence of `.git`, no `git` subprocess), today's date, project docs found (`AGENTS.md`/`CLAUDE.md`/`README.md` with a bounded head), and detected manifests.
- `buildRepoMap(cwd, { budget, ignore, maxDepth })` — a depth-first directory tree bounded by `budget` (default 8000 chars, `… (truncated)` marker), `maxDepth` (default 4), and a per-directory cap. Default ignores (`node_modules`/`.git`/`dist`/`.theo`/`.next`/`build`/`coverage`/`target`/`out` + dot-entries) merge with the caller's `ignore`. Directory symlinks are listed as leaves (not followed) so symlink loops cannot hang the walk.

Both NEVER throw — a missing/unreadable path yields an `(unavailable)` marker; an unreadable sub-directory is skipped. A best-effort orientation aid (not a complete or `.gitignore`-aware listing — deferred). Zero new dependencies (`node:fs`/`node:path` only).
