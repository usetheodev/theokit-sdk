# 08 — Checkpoints v2 (single shared shadow git store)

> Hermes' filesystem checkpoint system uses a single shared bare-ish git
> repo under `~/.hermes/checkpoints/store/` with per-project branches
> (`refs/hermes/<hash16>`), per-project indexes (`indexes/<hash16>`), and
> per-project metadata (`projects/<hash16>.json`). The v0.13 #20709
> rewrite (Checkpoints v2) replaced the pre-v2 per-project shadow repo
> design that re-stored most files under each worktree's own `objects/`
> tree — a single user with 12 worktrees burned ~500 MB. The shared store
> lets git's content-addressable DB deduplicate across projects and turns.
> Auto-prune drops orphan refs (workdir vanished), stale refs (last touch
> older than `retention_days`), and runs `git gc --prune=now`. Size-cap
> pass drops oldest checkpoints per project until total under
> `max_total_size_mb`. In TypeScript: `Checkpoint` namespace with
> `Checkpoint.ensure(workdir)`, `Checkpoint.list(workdir)`,
> `Checkpoint.restore(workdir, hash)`, `Checkpoint.prune(opts)`.

## What problem this domain solves

Two distinct problems:

1. **Undo for destructive tool calls**. The agent calls `write_file`, `patch`, or `terminal` with a destructive flag. A snapshot of the working directory *before* the operation lets the user `/rollback` if the agent goes off the rails.

2. **Storage efficiency**. The naïve design — one shadow git repo per working directory — exploded on users with multiple worktrees. The same npm `node_modules` got re-stored in each. The v2 rewrite is fundamentally about **deduplication via a single content-addressable object DB shared across all projects and all turns**.

The constraints:
- **Invisible to the agent.** The LLM never sees checkpoint tools (per `tools/checkpoint_manager.py:8`: "This is NOT a tool — the LLM never sees it."). Pure infrastructure.
- **Once per turn per directory.** Multiple file mutations in the same turn share one snapshot.
- **Cross-project deduplication.** Git's object DB does the work — same blob hash → stored once.
- **Bounded growth.** Auto-prune by age + size cap. Otherwise infinite accumulation.

## Hermes file layout

| File | LoC | Role |
|---|---|---|
| `tools/checkpoint_manager.py` | 1638 | `CheckpointManager` class. `ensure_checkpoint`, `list_checkpoints`, `restore`, `prune_checkpoints`. Single shared store implementation. |
| `hermes_cli/checkpoints.py` | 244 | `hermes checkpoint …` CLI subcommands. |
| `tests/tools/test_checkpoint_manager.py` | — | Unit tests. |
| `tests/integration/test_checkpoint_resumption.py` | — | Integration tests. |
| `tests/test_batch_runner_checkpoint.py` | — | Batch-runner integration. |

`wc -l`: 1882 LoC across the two production files.

## Canonical entry point

```python
# tools/checkpoint_manager.py:597
class CheckpointManager:
    def __init__(
        self,
        enabled: bool = False,
        max_snapshots: int = 20,
        max_total_size_mb: int = 500,
        max_file_size_mb: int = 10,
    ):
        self.enabled = enabled
        self.max_snapshots = max(1, int(max_snapshots))
        self.max_total_size_mb = max(0, int(max_total_size_mb))
        self.max_file_size_mb = max(0, int(max_file_size_mb))
        self._checkpointed_dirs: Set[str] = set()
        self._git_available: Optional[bool] = None

    def new_turn(self) -> None:
        """Reset per-turn dedup. Call at the start of each agent iteration."""
        self._checkpointed_dirs.clear()

    def ensure_checkpoint(self, working_dir: str, reason: str = "auto") -> bool:
        """Take a checkpoint if enabled and not already done this turn."""
```

## Happy path: agent calls write_file → checkpoint taken transparently → user restores

```
[Turn N starts]
  └─ CheckpointManager.new_turn() — clears _checkpointed_dirs set
  └─ Agent runs tool calls.

[Agent calls write_file("/proj/foo.py", "<new content>")]
  └─ write_file handler invokes manager.ensure_checkpoint("/proj", reason="write_file")
       └─ checkpoint_manager.py:623
       └─ enabled=True, git available, abs_dir not yet checkpointed this turn
       └─ self._take("/proj", "write_file")
            └─ Computes project_hash = sha1("/proj")[:16]
            └─ Opens ~/.hermes/checkpoints/store/  (single shared bare-ish git repo)
            └─ GIT_DIR=~/.hermes/checkpoints/store/
              GIT_WORK_TREE=/proj/
              GIT_INDEX_FILE=~/.hermes/checkpoints/store/indexes/<hash16>
            └─ Reads existing branch tip via `git rev-parse refs/hermes/<hash16>`
            └─ Stages all files matching include filter:
                 - Excludes from DEFAULT_EXCLUDES (node_modules, dist, .venv, etc.)
                 - Skips files larger than max_file_size_mb (10 MB)
            └─ Commits: git commit -m "auto: write_file" with the branch tip as parent
            └─ Updates refs/hermes/<hash16> → new commit hash
            └─ Writes projects/<hash16>.json: {workdir: "/proj", created_at, last_touch: now}
            └─ Returns True

[Agent continues with the write_file mutation]
[Same turn, agent calls patch("/proj/foo.py", "<patch>")]
  └─ manager.ensure_checkpoint("/proj", reason="patch")
       └─ /proj is in _checkpointed_dirs already → returns False (no-op)
       └─ Per-turn dedup means one checkpoint covers all mutations.

[User notices something wrong, runs `/rollback`]
  └─ checkpoints = manager.list_checkpoints("/proj")
       └─ checkpoint_manager.py:657
       └─ git log refs/hermes/<hash16> --format="%H|%h|%aI|%s" -n 20
       └─ Returns [{hash, short_hash, timestamp, reason, files_changed, insertions, deletions}]
  └─ User picks the checkpoint before the agent's edits.
  └─ manager.restore("/proj", commit_hash)
       └─ checkpoint_manager.py:761
       └─ git checkout-index --all to restore files in /proj from the picked commit
       └─ User's files are back to pre-edit state.

[Later, prune job runs]
  └─ prune_checkpoints(retention_days=7, retain_min=2, max_total_size_mb=500)
       └─ checkpoint_manager.py:1223
       └─ For each project hash in projects/:
            - Load projects/<hash16>.json
            - If workdir no longer exists → orphan, drop refs/hermes/<hash16>
            - If last_touch older than retention_days → stale, drop
            - Always preserve newest retain_min commits per project
       └─ git gc --prune=now
       └─ If total store size > max_total_size_mb → drop oldest commits per project
            until under cap
       └─ Archive legacy pre-v2 shadow repos older than retention_days
```

## Architectural decisions

### AD-1: Single shared bare-ish git store under `~/.hermes/checkpoints/store/`

- **Decision**: One git repo for *all* projects. Per-project branches (`refs/hermes/<hash16>`) and per-project indexes (`indexes/<hash16>`) keep them logically separated, but they share `objects/` for content-addressable deduplication.

- **Evidence**: `tools/checkpoint_manager.py:14-23`:

  ```
  ~/.hermes/checkpoints/
      store/                          — single bare-ish git repo
          HEAD, config, objects/      — standard git internals (shared)
          refs/hermes/<hash16>        — per-project branch tip
          indexes/<hash16>            — per-project git index
          projects/<hash16>.json      — {workdir, created_at, last_touch}
          info/exclude                — default excludes (shared)
      .last_prune                     — auto-prune idempotency marker
      legacy-<timestamp>/             — archived pre-v2 per-project shadow repos
  ```

- **Rationale**: `checkpoint_manager.py:26-37` explicitly:

  > The pre-v2 design kept a full shadow repo per working directory. Each one
  > re-stored most of the project's files under its own ``objects/`` tree,
  > with zero sharing across worktrees of the same project. A single user
  > with a dozen worktrees of the same repo burned ~40 MB each (~500 MB
  > total) storing the same blobs over and over. A single shared store lets
  > git's content-addressable object DB deduplicate across projects and
  > across turns, so adding a new worktree costs near-zero.

- **TypeScript translation**: Same layout under `~/.theokit/checkpoints/store/`. Use `simple-git` or shell out to `git` directly. We do NOT roll our own git internals.

### AD-2: GIT_DIR + GIT_WORK_TREE + GIT_INDEX_FILE — no git state in project dir

- **Decision**: All checkpoint git operations set `GIT_DIR`, `GIT_WORK_TREE`, and `GIT_INDEX_FILE` env vars to point at the store + project work tree + project index. No `.git` directory is ever created inside the user's project.

- **Evidence**: `tools/checkpoint_manager.py:39-41`:

  > The shadow store uses ``GIT_DIR`` + ``GIT_WORK_TREE`` + ``GIT_INDEX_FILE``
  > so no git state leaks into the user's project directory.

- **Rationale**: If we created `.git` in the project, we'd conflict with the user's *real* git repo (most projects have one). Setting env vars routes the operation to the shadow store while operating on the user's files.

- **TypeScript translation**: When shelling out to git, set the same env vars. `child_process.spawn("git", [...], { env: { ...process.env, GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE } })`.

### AD-3: Per-turn dedup so multiple mutations share one snapshot

- **Decision**: A `_checkpointed_dirs: Set[str]` instance variable tracks which directories already have a snapshot this turn. `new_turn()` clears it.

- **Evidence**: `checkpoint_manager.py:615-617, 646-649`:

  ```python
  def new_turn(self) -> None:
      """Reset per-turn dedup. Call at the start of each agent iteration."""
      self._checkpointed_dirs.clear()

  if abs_dir in self._checkpointed_dirs:
      return False
  self._checkpointed_dirs.add(abs_dir)
  ```

- **Rationale**: If the agent calls write_file, then patch, then terminal in one turn — we don't need 3 snapshots. One per turn captures the pre-turn state, which is what the user wants to roll back to.

- **TypeScript translation**: Identical pattern. `Set<string>` on the manager, cleared at turn start.

### AD-4: Auto-prune by orphan + stale + size cap

- **Decision**: `prune_checkpoints` does three passes: (1) orphan removal — workdir no longer exists; (2) stale removal — `last_touch` older than `retention_days` (default 7); (3) size cap — drop oldest per project until under `max_total_size_mb` (default 500).

- **Evidence**: `checkpoint_manager.py:1223-1390` (entire prune function). Key constants:

  ```python
  def prune_checkpoints(
      retention_days: int = 7,
      retain_min: int = 2,
      max_total_size_mb: int = 0,
      ...
  ):
  ```

- **Rationale**: Pre-v0.12 (#16303), shadow repos accumulated indefinitely. A heavy user could burn 5+ GB on stale checkpoint data. The three-pass prune is bounded growth + fairness (always preserve at least `retain_min=2` newest per project, even when stale).

- **TypeScript translation**: Same three-pass design. `Checkpoint.prune({ retentionDays: 7, retainMin: 2, maxTotalSizeMb: 500 })`.

### AD-5: File-size cap excludes individual large files

- **Decision**: `max_file_size_mb` (default 10) gates which files get added to a checkpoint. Files exceeding the cap are skipped.

- **Evidence**: `checkpoint_manager.py:592-594, 602-607`:

  ```python
  max_file_size_mb : int
      Skip adding any single file larger than this to a checkpoint.
      (Implemented via ``.gitignore`` excludes + a post-stage size check.)
  ```

- **Rationale**: A 200 MB ML model checkpoint or video file does not belong in the snapshot. The user almost certainly doesn't want to restore those. Skipping them keeps the store size sane.

- **TypeScript translation**: Same constant. Implement via `git check-ignore` per-file plus a `fs.stat` size check.

### AD-6: DEFAULT_EXCLUDES baked into the store

- **Decision**: `info/exclude` in the store has a curated list of patterns: `node_modules/`, `dist/`, `build/`, `target/`, `out/`, `.next/`, `.nuxt/`, `__pycache__/`, `*.pyc`, `.cache/`, `.pytest_cache/`, `.mypy_cache/`, `coverage/`, `.coverage`, `.venv/`, `venv/`, `env/`, etc.

- **Evidence**: `checkpoint_manager.py:79-` (constant `DEFAULT_EXCLUDES`).

- **Rationale**: Build outputs and caches change constantly and aren't worth snapshotting. Including them would dwarf the source in every commit.

- **TypeScript translation**: Same exclude list, plus TypeScript-specific (`.tsbuildinfo`, `tsconfig.tsbuildinfo`, `.angular/`, `.svelte-kit/`).

### AD-7: Skip overly broad directories

- **Decision**: Refuse to checkpoint `/`, `~`, or other paths matching a too-broad heuristic.

- **Evidence**: `checkpoint_manager.py:641-644`:

  ```python
  # Skip root, home, and other overly broad directories
  if abs_dir in {"/", str(Path.home())}:
      logger.debug("Checkpoint skipped: directory too broad (%s)", abs_dir)
      return False
  ```

- **Rationale**: An agent calling `cd /` followed by `write_file` would otherwise trigger a full filesystem snapshot. Disaster.

- **TypeScript translation**: Same blocklist + filesystem root + user home.

### AD-8: Pre-v2 legacy archives auto-migrated on first init

- **Decision**: On first `init` of v2, any existing per-project shadow repos from pre-v2 are archived to `legacy-<timestamp>/` under `CHECKPOINT_BASE`.

- **Evidence**: `checkpoint_manager.py:21` ("legacy-<timestamp>/ — archived pre-v2 per-project shadow repos (auto-migrated on first init)") and `_migrate_legacy_store` at `:339`.

- **Rationale**: Existing users have history in the old format. Don't delete it; archive it. Auto-prune of legacy archives kicks in via `retention_days`.

- **TypeScript translation**: Not needed for greenfield TheoKit — no legacy v1 checkpoint format to migrate from.

### AD-9: Idempotency marker `.last_prune` prevents prune storms

- **Decision**: `~/.hermes/checkpoints/.last_prune` tracks when prune last ran. Subsequent invocations check this and skip if too recent.

- **Evidence**: `checkpoint_manager.py:21` ("``.last_prune`` — auto-prune idempotency marker").

- **Rationale**: A gateway / cron job might trigger prune frequently. Real work (git gc on a multi-GB store) takes seconds. Idempotency prevents thrashing.

- **TypeScript translation**: Same marker file with mtime check.

### AD-10: Lazy git probe — graceful skip if git missing

- **Decision**: `_git_available: Optional[bool]` lazily probes `shutil.which("git")` on first use. If git is missing, checkpoints are silently disabled.

- **Evidence**: `checkpoint_manager.py:609, 632-637`:

  ```python
  if self._git_available is None:
      self._git_available = shutil.which("git") is not None
      if not self._git_available:
          logger.debug("Checkpoints disabled: git not found")
  if not self._git_available:
      return False
  ```

- **Rationale**: Hermes ships in environments where git may be missing (some Termux setups, slim Docker images). Hard-failing would block all agent work. Silent degradation keeps the agent functional, just without rollback.

- **TypeScript translation**: Lazy probe via `which` package. Same fallback.

### AD-11: Never raises — all errors logged at DEBUG

- **Decision**: `ensure_checkpoint` never raises. Any failure (git error, disk full, permission denied) is caught and logged at DEBUG.

- **Evidence**: `checkpoint_manager.py:651-655`:

  ```python
  try:
      return self._take(abs_dir, reason)
  except Exception as e:
      logger.debug("Checkpoint failed (non-fatal): %s", e)
      return False
  ```

- **Rationale**: Checkpoint is best-effort. A failure shouldn't block the actual tool call. The user just won't have rollback for this operation.

- **TypeScript translation**: Same try/catch pattern.

### AD-12: `git gc --prune=now` after structural cleanup

- **Decision**: After dropping orphan/stale refs, run `git gc --prune=now` to reclaim object storage.

- **Evidence**: `checkpoint_manager.py:46-48`:

  > `prune_checkpoints` deletes refs whose recorded working directory no longer
  > exists (orphan) or whose last touch is older than `retention_days` (stale),
  > then runs `git gc --prune=now` to reclaim object storage.

- **Rationale**: Deleting refs alone doesn't free storage. Git's `gc` walks the reachability graph and packs/deletes unreachable objects. `--prune=now` skips git's default 2-week grace period.

- **TypeScript translation**: Shell out: `git gc --prune=now`.

## Data structures

### Persisted

```
~/.theokit/checkpoints/
├── store/                                  # Single shared git store
│   ├── HEAD
│   ├── config
│   ├── objects/                           # Content-addressed blobs (deduped)
│   ├── refs/hermes/<hash16>               # Per-project branch tip
│   ├── indexes/<hash16>                   # Per-project git index
│   ├── projects/<hash16>.json             # {workdir, created_at, last_touch}
│   └── info/exclude                        # DEFAULT_EXCLUDES
├── .last_prune                             # Idempotency marker (epoch ts)
└── legacy-<ts>/                            # Migrated pre-v2 shadow repos
```

`projects/<hash16>.json`:

```json
{
  "workdir": "/home/x/projects/my-app",
  "created_at": 1715000000.0,
  "last_touch": 1715600000.0
}
```

### In-memory

```python
class CheckpointManager:
    enabled: bool
    max_snapshots: int             # default 20
    max_total_size_mb: int          # default 500
    max_file_size_mb: int           # default 10
    _checkpointed_dirs: Set[str]    # per-turn dedup
    _git_available: Optional[bool]  # lazy probe cache
```

### Concurrency model

- **Single writer per project**: git's index can only be modified by one process at a time. The shadow store inherits this. Two concurrent `ensure_checkpoint` calls on the same project would race; the per-turn dedup makes this rare in practice.
- **Cross-project parallelism**: different `<hash16>` indexes can be written in parallel.
- **No explicit locking** — git's index-locking (`.git/index.lock`) handles serialization.

## Failure modes Hermes already fixed

1. **Pre-v2 per-project repos burn 500 MB per user with 12 worktrees** — fixed by single shared store (v0.13 #20709).
2. **Orphan shadow repos accumulate forever** — fixed by orphan-detection prune (v0.12 #16303 added auto-prune at startup, refined in v0.13).
3. **Stale shadow repos for projects last touched months ago** — fixed by `last_touch` field + `retention_days` cutoff.
4. **`/` or `~` accidentally snapshotted** — explicit blocklist at `:641-644`.
5. **Multi-GB single files** (videos, model checkpoints) — `max_file_size_mb` cap.
6. **Build artifacts dwarf source** — DEFAULT_EXCLUDES.
7. **Per-turn over-snapshotting** — `_checkpointed_dirs` dedup set.
8. **Git missing on system** — lazy probe + silent degradation.
9. **Checkpoint failure blocks tool call** — never-raise discipline.
10. **Pre-v0.12 corruption from `--no-renormalize`** — fixed by explicit `git config` per shadow store.
11. **`.git` leaking into project dir** — GIT_DIR + GIT_WORK_TREE + GIT_INDEX_FILE.
12. **Checkpoint hash collisions on similar workdir paths** — hash16 is 16 hex chars = 64 bits, collision-resistant for billions of paths.

## TypeScript API proposal

### Public surface

```typescript
// src/index.ts
export class Checkpoint {
  static async create(options: CheckpointOptions): Promise<Checkpoint>;
  newTurn(): void;
  async ensure(workingDir: string, reason?: string): Promise<boolean>;
  async list(workingDir: string): Promise<CheckpointInfo[]>;
  async restore(workingDir: string, commitHash: string, opts?: { filePath?: string }): Promise<{ restored: string[] }>;
  async prune(opts?: PruneOptions): Promise<PruneReport>;
  async [Symbol.asyncDispose](): Promise<void>;
}

export interface CheckpointOptions {
  enabled?: boolean;            // default false (opt-in)
  maxSnapshots?: number;        // per-project, default 20
  maxTotalSizeMb?: number;      // global, default 500
  maxFileSizeMb?: number;       // per-file, default 10
}

export interface CheckpointInfo {
  hash: string;
  shortHash: string;
  timestamp: string;
  reason: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface PruneOptions {
  retentionDays?: number;       // default 7
  retainMin?: number;           // newest N preserved even when stale, default 2
  maxTotalSizeMb?: number;      // size cap, default 0 (off)
}

export interface PruneReport {
  orphansRemoved: number;
  staleRemoved: number;
  sizeCapDrops: number;
  storeSizeMb: number;
}
```

### Internal module layout

```
packages/sdk/src/internal/checkpoints/
├── manager.ts                 # CheckpointManager
├── store.ts                   # Bare-ish git store init / open
├── ensure.ts                  # ensure_checkpoint
├── list.ts                    # list_checkpoints
├── restore.ts                 # restore
├── prune.ts                   # prune_checkpoints (3-pass)
├── git-shell.ts               # Shell-out helper for git operations
├── excludes.ts                # DEFAULT_EXCLUDES list
└── paths.ts                   # CHECKPOINT_BASE, project_hash, ref_name
```

### Persistence layout

```
~/.theokit/checkpoints/
├── store/                       # Same as Hermes
├── .last_prune
└── legacy-<ts>/                 # Reserved for future migrations
```

### Optional peer dependencies

| Dep | Why | When required |
|---|---|---|
| `simple-git` | Optional convenience over shell-out | If we adopt; otherwise shell out via `child_process` |
| `git` (system) | The actual git binary | Required at runtime; lazy-probed |

### Migration impact on v1.2 users

- **Backward-compatible**: Yes. v1.2 had no `Checkpoint` namespace; this is new.
- **Breaking signature changes**: None.

## Test strategy

Hermes tests to port:

- `tests/tools/test_checkpoint_manager.py` — unit tests for ensure / list / restore / prune
- `tests/integration/test_checkpoint_resumption.py` — full restore flow
- `tests/test_batch_runner_checkpoint.py` — batch-runner integration

**Unit tests**:
- ensure_checkpoint: turn-dedup, blocklist (root/home), file-size cap, exclude patterns
- list_checkpoints: ordering, shortstat parsing
- prune: 3-pass behavior (orphan / stale / size cap), retain_min preservation, idempotency marker
- Restore: file-level vs full restore, conflict handling

**Integration tests**:
- Real git shell, real filesystem, real `git gc`.
- Multi-project deduplication: two worktrees of the same repo share blobs.

**Examples to ship**:
- `examples/checkpoint-restore/` — agent edits file, user reverts.
- `examples/checkpoint-prune/` — large-store prune dry-run + apply.

## Open questions

- **simple-git vs shell-out**: simple-git wraps the binary anyway. Shell-out is simpler and has fewer deps. Recommend shell-out.
- **Checkpoint enable by default?** Hermes defaults to false (`enabled: bool = False`, `:599`). Users opt in via `--checkpoints` flag or config. Recommend same default.
- **Per-language excludes**: should `DEFAULT_EXCLUDES` be configurable, or do we ship one curated list? Recommend configurable via `options.excludes: string[]`.
- **Atomic restore**: if restore fails mid-way (disk full, permission denied), what's the recovery? Hermes doesn't seem to atomic-rollback. Document the risk; recommend filesystem snapshot via `cp -a` before restore for paranoid users.

## References

- `referencia/hermes-agent/tools/checkpoint_manager.py:1-1638`
- `referencia/hermes-agent/hermes_cli/checkpoints.py:1-244`
- RELEASE_v0.2.0.md PR #824 — initial filesystem checkpoints + `/rollback`
- RELEASE_v0.12.0.md PR #16303 — auto-prune orphan and stale shadow repos
- RELEASE_v0.13.0.md PR #20709 — Checkpoints v2 single-store rewrite
- AGENTS.md (no explicit checkpoints section; referenced in test discipline)
- Theokit ADRs: none specific.
