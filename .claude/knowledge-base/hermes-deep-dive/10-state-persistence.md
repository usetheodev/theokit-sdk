# 10 — State Persistence (Cross-Cutting)

> The `~/.hermes/` tree (or `HERMES_HOME` under profiles / Docker) is the
> single anchor for all of Hermes' persistent state. This doc surveys the
> directory layout, the two storage backends in use (SQLite WAL + atomic
> JSON files), the file-locking patterns, the profile-isolation
> mechanism, and the migration discipline. Every prior domain doc
> references something here. In TypeScript: a single `getTheokitHome()`
> function plus per-feature subdirectories under `~/.theokit/` matching
> Hermes' layout 1:1.

## What problem this domain solves

Hermes is a long-running, multi-process agent platform. State has to survive: (1) individual session crashes; (2) profile switches; (3) gateway restarts; (4) Docker container restarts; (5) machine reboots. The state has many shapes — small key-value (last-used model), structured records (sessions, kanban tasks), large blobs (skill files, checkpoint snapshots).

The wrong design is one big database. The right design is what Hermes actually has: **two storage primitives layered correctly**:

1. **SQLite** for transactional structured queries: sessions, messages, FTS5, kanban, batch runner state. WAL mode for concurrent readers + one writer. NFS-incompat fallback to DELETE.

2. **Atomic JSON files** for configuration and small records: config.yaml, .env, cron/jobs.json, skill files, plugin manifests. Write to temp, fsync, rename. File locks (fcntl/msvcrt) for cross-process serialization where needed.

The third dimension is **profile isolation**. `HERMES_HOME` is set early in startup (`_apply_profile_override` in `hermes_cli/main.py`); every path lookup downstream uses `get_hermes_home()` instead of hardcoding `~/.hermes`. Five bugs from hardcoded paths got fixed in PR #3575 (per AGENTS.md:928).

## The complete `~/.hermes/` layout

Confirmed via `grep "get_hermes_home() /"` across the codebase. Top-level entries:

```
~/.hermes/
├── .anthropic_oauth.json         # Anthropic OAuth tokens
├── auth/                         # Per-provider auth credentials
├── auth.json                     # Consolidated auth store
├── browser_screenshots/          # Browser tool's screenshots
├── cache/                        # General-purpose cache (responses, models.dev, etc.)
├── checkpoints/                  # Checkpoint v2 shared store (doc 08)
│   ├── store/                   # The shared git repo
│   ├── .last_prune
│   └── legacy-*/
├── chrome-debug/                 # Camofox / browser-CDP debug data
├── config.yaml                   # User configuration (atomic write)
├── .container-mode               # Docker mode marker
├── context_length_cache.yaml     # Per-model context length cache
├── creds.json                    # Credentials registry
├── cron/                         # Cron infrastructure (doc 09)
│   ├── jobs.json                # All job definitions (atomic write)
│   ├── .tick.lock               # File lock preventing duplicate ticks
│   └── outputs/                  # Per-job stdout history
├── .curator_backups/             # Pre-run skill tar.gz snapshots
├── .curator_state                # Curator state JSON (doc 03)
├── dashboard-themes/             # Web dashboard themes
├── .env                          # Secrets (atomic write, 0600 perms)
├── gateway.log                   # Gateway-specific log
├── google_oauth.json             # Google OAuth tokens
├── honcho.json                   # Honcho config (doc 05)
├── images/                       # Image inputs to vision tool
├── jobs.json                     # Legacy cron path (alias for cron/jobs.json)
├── kanban.db                     # Kanban default board (doc 01)
├── kanban/                       # Per-board kanban data
│   ├── current                  # Active board slug
│   ├── workspaces/
│   ├── logs/
│   └── boards/<slug>/
├── logs/                         # All logs
│   ├── agent.log                # INFO+
│   ├── errors.log               # WARNING+
│   ├── gateway.log              # (also at root for legacy)
│   └── curator/                 # Per-run curator reports
├── .managed                      # Profile-managed mode marker
├── memories/                     # Built-in memory (memory.md + user.md)
├── model_catalog.json            # Cached provider model lists
├── models_dev_cache.json         # models.dev integration cache
├── ollama_cloud_models_cache.json
├── optional-skills/              # Heavy skills, opt-in install
├── pastes/                       # paste.rs / debug share artifacts
├── pending.json                  # Update-pending state (atomic write)
├── plugins/                      # User-installed plugins
│   ├── model-providers/         # Provider plugin overrides (doc 07)
│   ├── memory/                  # Memory provider plugins (doc 05)
│   ├── kanban/                  # Kanban plugin (dashboard, etc.)
│   └── <general>/               # General-purpose plugins
├── profiles/                     # Per-profile HERMES_HOMEs
│   └── <profile-name>/
├── sandboxes/                    # Backend storage (doc 06)
│   ├── docker/
│   ├── singularity/
│   └── modal/
├── scripts/                      # User-provided scripts (cron / hooks)
├── sessions.json                 # Legacy session metadata (superseded by state.db)
├── skills/                       # Agent-discoverable skills
│   ├── .usage.json              # Per-skill telemetry (doc 03)
│   ├── .usage.json.lock         # File lock
│   ├── .bundled_manifest        # Provenance: bundled skills
│   ├── .hub/lock.json           # Provenance: hub-installed
│   ├── .archive/                # Archived skills + snapshots
│   ├── .curator-runs/           # Per-run curator reports
│   └── <category>/<skill>/      # Actual skill directories
├── skins/                        # Custom CLI skin YAMLs
├── state.db                      # The main SQLite DB (doc 04)
├── state.db-wal                  # WAL sidecar
└── state.db-shm                  # Shared-memory sidecar
```

That's **~35 top-level entries**. Each maps to a feature documented elsewhere.

## Architectural decisions

### AD-1: `HERMES_HOME` env var anchors every path

- **Decision**: `_apply_profile_override()` in `hermes_cli/main.py` sets `HERMES_HOME` *before any module imports*. Every path lookup downstream goes through `get_hermes_home()` from `hermes_constants.py`.

- **Evidence**: AGENTS.md:872-883:

  > The core mechanism: ``_apply_profile_override()`` in ``hermes_cli/main.py`` sets
  > ``HERMES_HOME`` before any module imports. All ``get_hermes_home()`` references
  > automatically scope to the active profile.

  Plus the Five Rules at AGENTS.md:877-921.

- **Rationale**: Profiles must be isolated. Hardcoded `~/.hermes` would force one global state. PR #3575 fixed 5 bugs from hardcoded paths (per AGENTS.md:928).

- **TypeScript translation**: `getTheokitHome()` function in `packages/sdk/src/internal/paths.ts` reads `THEOKIT_HOME` env var, defaults to `~/.theokit`. Every other path goes through this function — verified by an ESLint rule banning `os.homedir() + "/.theokit"` literals.

### AD-2: Two storage primitives — SQLite (transactional) + atomic JSON (configuration)

- **Decision**: SQLite for things that need transactions, indexes, FTS. JSON files for config and small records. Atomic-rename pattern on every JSON write.

- **Evidence**: Multiple sites:
  - SQLite: `hermes_state.py` (sessions/messages), `hermes_cli/kanban_db.py` (kanban)
  - Atomic JSON: `agent/curator.py:97-115` (curator state), `cron/jobs.py` (jobs.json), `~/.hermes/.env` (PR #954, v0.2)
  - Atomic-write pattern (canonical): `tempfile.mkstemp` → `os.fdopen` → `f.flush()` → `os.fsync(f.fileno())` → `os.replace(tmp, path)`

- **Rationale**: Right tool for the job. SQLite gives ACID for messages. JSON gives readability + atomic safety for config. Mixing them avoids the "everything is a SQLite blob" anti-pattern that makes config impossible to grep.

- **TypeScript translation**: `better-sqlite3` for SQLite. `fs.writeFile` + `fs.rename` helper `atomicWriteJson(path, value)` for JSON. Both wrapped in `packages/sdk/src/internal/persistence/`.

### AD-3: WAL mode for SQLite with DELETE fallback

- **Decision**: All SQLite DBs use `PRAGMA journal_mode=WAL`. If the filesystem (NFS/SMB/FUSE) rejects WAL, fall back to `DELETE`. One WARNING per process per database.

- **Evidence**: `hermes_state.py:128-183` `apply_wal_with_fallback` (covered in doc 04).

- **Rationale**: WAL = concurrent readers + one writer = fast multi-process access. Without fallback, NFS users lose every feature backed by state.db.

- **TypeScript translation**: Same pattern in our SessionDB helper (doc 04).

### AD-4: File locks (fcntl/msvcrt) for cross-process serialization

- **Decision**: Resources that need cross-process write serialization use OS-level file locks: `fcntl.flock` on POSIX, `msvcrt.locking` on Windows. Documented locks:
  - `~/.hermes/cron/.tick.lock` — scheduler tick deduplication (AGENTS.md:787)
  - `~/.hermes/skills/.usage.json.lock` — `skill_usage.bump_use` serialization (`tools/skill_usage.py:67-96`)
  - Gateway platform token locks (`acquire_scoped_lock` from `gateway.status`, AGENTS.md:912-916)

- **Rationale**: SQLite handles its own locking via WAL. For non-SQLite resources (config files, .usage.json, cron jobs.json), an OS-level lock prevents two processes from corrupting each other's writes.

- **TypeScript translation**: `proper-lockfile` package. One uniform helper that abstracts fcntl/msvcrt. Same lock paths under `~/.theokit/`.

### AD-5: Atomic rename pattern (canonical implementation)

- **Decision**: Every JSON write follows this pattern:

  ```python
  fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".prefix_", suffix=".tmp")
  with os.fdopen(fd, "w", encoding="utf-8") as f:
      json.dump(data, f)
      f.flush()
      os.fsync(f.fileno())
  os.replace(tmp, path)
  ```

  On exception: unlink the temp file.

- **Evidence**: `agent/curator.py:97-115`. Replicated across multiple modules.

- **Rationale**: A crash mid-write leaves the original file intact. A successful write atomically replaces it. fsync ensures durability across power loss.

- **TypeScript translation**: Same pattern using `fs.promises.writeFile(tmpPath, data)` + `fs.promises.fsync(fd)` + `fs.promises.rename(tmpPath, path)`. Wrap in `atomicWriteJson` helper.

### AD-6: Profile-scoped storage in `profiles/<name>/`

- **Decision**: Profiles get their own HERMES_HOME under `~/.hermes/profiles/<name>/`. Activated by `hermes -p <name>` which sets `HERMES_HOME=~/.hermes/profiles/<name>` before any imports.

- **Evidence**: AGENTS.md:866-921. Profile operations (`profile list`, `profile create`, etc.) are HOME-anchored, not HERMES_HOME-anchored (AGENTS.md:918-921):

  > **Profile operations are HOME-anchored, not HERMES_HOME-anchored** — ``_get_profiles_root()`` returns ``Path.home() / ".hermes" / "profiles"``, NOT ``get_hermes_home() / "profiles"``. This is intentional — it lets ``hermes -p coder profile list`` see all profiles regardless of which one is active.

- **Rationale**: Profiles are isolated state but discoverable from any context. Path.home() anchors the discovery; HERMES_HOME anchors the in-profile state.

- **TypeScript translation**: Same dichotomy. `getTheokitHome()` returns the profile-scoped path; `getProfilesRoot()` always returns `os.homedir() + "/.theokit/profiles"`.

### AD-7: `display_hermes_home()` for user-facing strings

- **Decision**: User-facing print/log messages use `display_hermes_home()` which returns the *display string* (`~/.hermes` or `~/.hermes/profiles/<name>`), not the resolved absolute path.

- **Evidence**: AGENTS.md:889-898 plus the actual `display_hermes_home()` function in `hermes_constants.py`.

- **Rationale**: Two purposes. Function calls need the absolute path (`get_hermes_home()`). Help text and error messages need the user-readable version. Conflating them breaks profile display.

- **TypeScript translation**: `displayTheokitHome(): string` function. Two helpers, one for code paths, one for messages.

### AD-8: Token locks on gateway platform credentials

- **Decision**: Gateway platform adapters that connect with unique credentials (bot tokens, API keys) acquire a scoped file lock. Prevents two profiles from running the same bot on the same token.

- **Evidence**: AGENTS.md:912-916. `gateway/platforms/telegram.py` is cited as the canonical pattern.

- **Rationale**: Telegram allows only one polling client per bot token. Two profiles polling the same bot causes 409 conflicts. The file lock makes "claim the token, run, release" atomic.

- **TypeScript translation**: For the SDK, this concern is mostly out-of-scope — we don't run gateways. But the lock primitive is the same `proper-lockfile`.

### AD-9: Migration paths (not deletions) when schema bumps

- **Decision**: Schema migrations on bumped versions move data forward without losing it. Pre-v2 checkpoint repos are archived to `legacy-*/` (doc 08). Pre-rename kanban column data migrated via COALESCE (doc 01).

- **Evidence**: `tools/checkpoint_manager.py:339` `_migrate_legacy_store`. `hermes_cli/kanban_db.py:1024-1035` migrates `spawn_failures` → `consecutive_failures`. `hermes_state.py:36` `SCHEMA_VERSION = 11` plus migration runner.

- **Rationale**: User trust. Losing state on upgrade is unacceptable. Migration + archive lets users roll back if a new version regresses.

- **TypeScript translation**: Schema version table + ordered forward-only migration runner. Per-feature legacy archive folders where applicable.

### AD-10: Schema version stored in DB, not just `package.json`

- **Decision**: SQLite DBs track their own schema_version row. `SCHEMA_VERSION = 11` constant in `hermes_state.py:36`.

- **Evidence**: `hermes_state.py:186-188`:

  ```sql
  CREATE TABLE schema_version (
      version INTEGER NOT NULL
  );
  ```

- **Rationale**: The DB file can be opened by older or newer Hermes versions. Inspecting the row tells the runtime whether to migrate, refuse, or warn.

- **TypeScript translation**: Same `schema_version` table. Runtime constant `SCHEMA_VERSION`. Migration runner checks the row first.

### AD-11: Profile tests must monkeypatch BOTH `Path.home()` and `HERMES_HOME`

- **Decision**: Tests that touch profile features set both `Path.home()` (for profile discovery) and `HERMES_HOME` (for current-profile state). Otherwise they leak between tests.

- **Evidence**: AGENTS.md:973-985 (the `profile_env` fixture pattern).

- **Rationale**: Two anchors, two mocks. Profile discovery uses Path.home; in-profile state uses HERMES_HOME.

- **TypeScript translation**: Same dual mocking. Vitest fixture `withTempProfile()` that sets both `os.homedir` (via test-double) and `THEOKIT_HOME` env var.

### AD-12: Tests must not write to `~/.hermes/` — autouse fixture isolates

- **Decision**: `tests/conftest.py` has an autouse fixture `_isolate_hermes_home` that redirects `HERMES_HOME` to a temp dir before every test. NO test may write to the real `~/.hermes/`.

- **Evidence**: AGENTS.md:970-972.

- **Rationale**: Test pollution. A leftover file from a test could affect every subsequent test or the developer's actual Hermes install. Hermetic = required.

- **TypeScript translation**: Vitest `beforeAll`/`beforeEach` hook in `packages/sdk/vitest.setup.ts` that sets `THEOKIT_HOME` to `os.tmpdir() + "/theokit-test-<uuid>"` and cleans up afterward.

## Failure modes Hermes already fixed

1. **Hardcoded `~/.hermes` breaks profiles** — PR #3575 fixed 5 instances.
2. **Atomic writes prevented mid-crash corruption** — multiple PRs across modules.
3. **NFS/SMB silently breaks SQLite** — WAL fallback (doc 04).
4. **File-lock convoys with deterministic sleep** — jittered retries (doc 04 AD-10).
5. **Tests bleeding state between runs** — autouse fixture.
6. **Profile token collisions across two profiles** — scoped token locks (doc 05 AD-12 cross-ref).
7. **Squash-merge from stale branch silently reverts state-handling fixes** — AGENTS.md:957-963.
8. **Wiring dead code without E2E validation** — AGENTS.md:965-968.
9. **WAL warning floods errors.log on NFS** — dedup (doc 04 AD-3).
10. **TermUX `/tmp` missing** — env-var driven temp dir (doc 06 AD-11).
11. **Config writes overwrite during interrupt** — atomic write everywhere.
12. **Schema migration mid-upgrade corrupts** — schema_version + forward migrations (AD-9).

## TypeScript API proposal

### Public surface

This domain is mostly *internal infrastructure*. The user-facing API is implicit — users see it through:

```typescript
// src/index.ts (already exposed for many features)

// Implicit: Agent.create({…}) honors THEOKIT_HOME and per-profile mode.
// Implicit: Memory, Cron, Kanban, Checkpoint all use the same persistence helpers.

// Explicit utility for advanced users:
export function getTheokitHome(): string;
export function getProfilesRoot(): string;
export function applyProfileOverride(profileName: string | null): void;
```

### Internal module layout

```
packages/sdk/src/internal/paths.ts                # getTheokitHome, getProfilesRoot, applyProfileOverride
packages/sdk/src/internal/persistence/
├── atomic-write.ts             # atomicWriteJson, atomicWriteText
├── file-lock.ts                # withFileLock — proper-lockfile wrapper
├── schema-version.ts           # generic schema_version table helper
└── jittered-retry.ts           # withJitteredRetry — 20-150ms × 15
```

### Persistence layout (TheoKit equivalent)

```
~/.theokit/
├── auth/                       # Per-provider auth
├── auth.json
├── cache/
├── checkpoints/
├── config.yaml
├── .env
├── kanban.db
├── kanban/
├── logs/
├── memories/
├── plugins/
├── profiles/
├── scripts/
├── sandboxes/
├── skills/
└── state.db
```

Slimmer than Hermes — we don't ship gateways, dashboard themes, browser screenshots, or model catalog caches.

### Migration impact on v1.2 users

- **Backward-compatible**: Yes if v1.2 used the existing config layout. We adopt `~/.theokit/` as the new default; users who had v1.2 state under a different path can override via `THEOKIT_HOME`.
- **Breaking signature changes**: None.

## Test strategy

- Path resolution: `getTheokitHome()` returns correct path under profile / Docker / WSL / Windows.
- Atomic write: simulate crash mid-write, assert original file intact.
- File lock: spawn 5 threads contending for a write, assert serialization.
- Profile isolation: set up two profiles, assert state doesn't leak.
- Schema migration: open v1 DB with v2 code, assert migration runs cleanly.

## Open questions

- **HERMES_HOME → THEOKIT_HOME migration**: do we offer a `theokit migrate-from-hermes` tool? Probably yes, but defer to a separate "interop" doc.
- **Docker profile mode**: Hermes' `.container-mode` marker is a runtime hint. Do we need an equivalent?
- **`~/.theokit/managed`**: Hermes uses `.managed` as a profile-managed mode marker. Same need in TheoKit?

## References

- `referencia/hermes-agent/AGENTS.md:866-985` — Profiles + Known Pitfalls sections
- `referencia/hermes-agent/hermes_constants.py` — `get_hermes_home`, `display_hermes_home`
- `referencia/hermes-agent/hermes_cli/main.py` — `_apply_profile_override`
- All prior domain docs in this deep-dive (each references persistence)
- Theokit ADRs:
  - D8 — JSON persistence + atomic write
  - D9 — Memory namespace/scope defaults
