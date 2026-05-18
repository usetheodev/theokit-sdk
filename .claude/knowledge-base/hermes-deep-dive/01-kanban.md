# 01 — Multi-Agent Kanban (durable, multi-profile)

> Hermes ships a SQLite-backed task board where multiple Hermes worker
> processes pick up tasks, heartbeat their progress, and hand off through
> structured comments. The board enforces atomic single-claimer semantics via
> WAL + CAS on `tasks.status` and `tasks.claim_lock`, distinguishes between
> "stale by TTL but PID alive" and "stale and dead" claims, traps worker
> hallucinations that claim to have created cards that do not exist, and
> auto-blocks tasks that consecutively fail. The same shape, expressed in
> TypeScript, is the v1.3 `Kanban` namespace under `@usetheo/sdk` —
> `Kanban.create(boardOptions)`, `Kanban.claimTask()`, `Kanban.heartbeat()`,
> `Kanban.completeTask({ createdCards })`, and a `Dispatcher` loop with the
> same circuit breakers.

## What problem this domain solves

A single Hermes agent ties up a session for the duration of a task. When you want N agents working a backlog cooperatively — one running TypeScript codegen, one researching, one writing tests, one reviewing — you need a durable handoff between them. The handoff has three properties no in-memory queue gives you:

1. **Survives process death.** A worker that crashes mid-task must not lose its claim *forever* — another worker has to pick the task up. But it also must not lose its claim *immediately* — the original may recover.
2. **Survives lying.** LLMs hallucinate. When a worker tells the kernel "I completed task X and created follow-ups Y and Z", the kernel must verify Y and Z actually exist in the DB before believing the completion.
3. **Survives runaways.** A worker stuck in a tool loop with `max_iterations=90` and a 200s response time can hold the lock for *hours*. The board has to reclaim it without taking the live worker's word for whether it is alive.

These three properties combined define the v0.13 kanban: it is **distributed mutex + identity verification + watchdog**, persisted to SQLite.

## Hermes file layout

| File | LoC | Role |
|---|---|---|
| `hermes_cli/kanban_db.py` | 4839 | Schema, claim machinery, dispatcher loop, hallucination gate. The brain. |
| `hermes_cli/kanban.py` | 2252 | `hermes kanban …` CLI — init/create/list/show/assign/complete/block/heartbeat verbs. |
| `tools/kanban_tools.py` | 1139 | The agent-facing tool surface: `kanban_show`, `kanban_complete`, `kanban_block`, `kanban_heartbeat`, `kanban_comment`, `kanban_create`, `kanban_link`. |
| `hermes_cli/kanban_diagnostics.py` | 776 | Generic distress-signal detector for stuck workers (`kanban: Generic diagnostics engine for task distress signals` — RELEASE_v0.13 #20332). |
| `hermes_cli/kanban_specify.py` | 266 | Planning / specification helper attached to triage tasks. |
| `plugins/kanban/dashboard/plugin_api.py` | 1612 | Web dashboard plugin: board view, drag-and-drop, real-time updates. |
| `tests/stress/test_concurrency*.py` (5 files) | 1394 | Concurrency stress tests — claim races, reclaim races, parent gate, mixed scenarios, property fuzzing. |
| `tests/stress/test_atypical_scenarios.py` | 1060 | Edge cases. |
| `tests/hermes_cli/test_kanban_*.py` (9 files) | ~2300 | Per-feature unit tests. |
| `tests/tools/test_kanban_tools.py` | — | Tool-handler tests. |
| `tests/gateway/test_kanban_notifier.py` | — | Gateway-watcher tests. |
| `skills/devops/kanban-orchestrator/` | — | The agent skill that drives the orchestrator role. |
| `skills/devops/kanban-worker/` | — | The agent skill the dispatcher loads onto every spawned worker. |
| `plugins/kanban/systemd/hermes-kanban-dispatcher.service` | — | Standalone-dispatcher systemd unit (per AGENTS.md:819). |

Confirmed with `wc -l` and `find -type f -name "*kanban*"`. Total kanban core: **10,884 LoC** across 6 production files; tests: **5,288 LoC** across 18 test files.

## Canonical entry point

The board's atomic state transitions live in `kanban_db.py`. The single function every other path eventually goes through is:

```python
# hermes_cli/kanban_db.py:1861
def claim_task(
    conn: sqlite3.Connection,
    task_id: str,
    *,
    ttl_seconds: int = DEFAULT_CLAIM_TTL_SECONDS,  # 15 * 60 = 900s
    claimer: Optional[str] = None,
) -> Optional[Task]:
    """Atomically transition ``ready -> running``.

    Returns the claimed ``Task`` on success, ``None`` if the task was
    already claimed (or is not in ``ready`` status).
    """
```

`claim_task` is the gate; **no worker may operate on a task without first having claim_task return non-None**. The transition is a single `UPDATE … WHERE id = ? AND status = 'ready' AND claim_lock IS NULL` (kanban_db.py:1922-1934). SQLite serializes writers via WAL+`BEGIN IMMEDIATE`, so at most one claimer wins per task.

## Happy path: dispatcher claims a ready task, worker completes it

Tracing one realistic scenario from board init to clean completion:

```
USER: hermes kanban init
  └─ hermes_cli/kanban.py:cli_init()
       └─ kanban_db.init_db(board=None)  # kanban_db.py:941
            ├─ connect()  # kanban_db.py:892
            │    └─ PRAGMA journal_mode=WAL, busy_timeout=5000, foreign_keys=ON
            ├─ executescript(SCHEMA_SQL)  # kanban_db.py:753
            └─ _migrate_add_optional_columns()  # kanban_db.py:989
                 └─ Adds consecutive_failures (rename of spawn_failures), max_retries, etc.
                 └─ ALSO migrates pre-#20410 spawn_failures column data in (kanban_db.py:1024-1035)

USER: hermes kanban create "Write the auth tests" --assignee builder --workspace-kind worktree
  └─ kanban_db.create_task(title, assignee, status="triage", …)  # kanban_db.py:1230
       └─ INSERT INTO tasks
       └─ _append_event(conn, task_id, "created", {…})
       └─ Returns task_id like "t_a3f01c7b9d24"

[Triage gets promoted via assignment or specify, ends up status='ready']

[Gateway-embedded dispatcher tick — runs every kanban.dispatch_interval seconds, default 60s]
  └─ kanban_db.dispatch_once(conn, …)  # kanban_db.py:3666
       1. release_stale_claims(conn)  # kanban_db.py:2006 — see Failure Modes
       2. detect_crashed_workers(conn)  # kanban_db.py:3292
       3. enforce_max_runtime(conn)  # kanban_db.py:3164 — SIGTERM/SIGKILL the runaway
       4. recompute_ready(conn)  # kanban_db.py:1828 — promote 'todo' → 'ready' once parents 'done'
       5. For each ready+assigned task: spawn worker subprocess

[Dispatcher decides to claim and spawn for task_id "t_a3f01c7b9d24"]
  └─ claim_task(conn, "t_a3f01c7b9d24")  # kanban_db.py:1861
       1. SELECT 1 FROM task_links WHERE child_id=? AND parent.status NOT IN ('done','archived')
          ── Demote to 'todo' if any parent not done (kanban_db.py:1885-1900). This re-runs
          ── the structural invariant on every claim, defending against racy writers.
       2. UPDATE tasks SET status='running', claim_lock=?, claim_expires=now+900s, started_at=now
            WHERE id=? AND status='ready' AND claim_lock IS NULL  (CAS — kanban_db.py:1922)
       3. INSERT INTO task_runs (task_id, profile, status='running', claim_lock, started_at)
            ── Per-attempt row. Multiple per task_id on retries (kanban_db.py:1944-1961).
       4. UPDATE tasks SET current_run_id=? WHERE id=?
       5. _append_event(conn, task_id, "claimed", {lock, expires, run_id})

[Dispatcher spawns the subprocess with env injection]
  └─ _default_spawn(…)  # kanban_db.py:3905
       └─ subprocess.Popen(
              ["hermes", "-p", "builder", "chat", "--skills", "kanban-worker"],
              env={
                  ...os.environ,
                  "HERMES_KANBAN_TASK":   "t_a3f01c7b9d24",
                  "HERMES_KANBAN_RUN_ID": "47",
                  "HERMES_KANBAN_BOARD":  "default",
                  "HERMES_KANBAN_DB":     "/home/x/.hermes/kanban.db",
                  "HERMES_KANBAN_WORKSPACES_ROOT": "/home/x/.hermes/kanban/workspaces",
              },
          )
       └─ _set_worker_pid(conn, task_id, pid)  # kanban_db.py:3591

[Inside the spawned worker]
  └─ The agent loads `kanban-worker` skill (skills/devops/kanban-worker/SKILL.md).
  └─ The kanban toolset is enabled because HERMES_KANBAN_TASK is set
      (tools/kanban_tools.py:_check_kanban_mode line 59).
  └─ The agent sees a system prompt that includes build_worker_context() output —
     parent results, prior attempt summaries, comment history.
  └─ The model calls kanban_show first to read full task state.
  └─ The model calls terminal tools, writes code, runs tests …
  └─ The agent periodically calls kanban_heartbeat to extend the 15-min claim.

[Long-running worker calls kanban_heartbeat every ~5 min]
  └─ tools/kanban_tools.py:_handle_heartbeat → kanban_db.heartbeat_claim(conn, tid)
       └─ kanban_db.py:1975
       └─ UPDATE tasks SET claim_expires=now+900s WHERE id=? AND status='running' AND claim_lock=?
       └─ UPDATE task_runs SET claim_expires=? WHERE id=?
       └─ Returns True iff we still own the claim.

[Worker finishes — model calls kanban_complete]
  └─ tools/kanban_tools.py:_handle_complete  # tools/kanban_tools.py
  └─ kanban_db.complete_task(conn, tid, summary=…, result=…, created_cards=["t_…","t_…"])
       └─ kanban_db.py:2351
       1. _verify_created_cards(conn, task_id, created_cards)  ─── HALLUCINATION GATE
          ── kanban_db.py:2219
          ── A card is "verified" iff:
              - tasks.created_by == this_task.assignee  (worker A spawned card via kanban_create)
              - OR tasks.created_by == this_task.id  (edge case where worker stamped own id)
              - OR card is linked as task_links.child of this_task
          ── Anything else is PHANTOM — raises HallucinatedCardsError.
       2. If phantom non-empty:
              _append_event(conn, task_id, "completion_blocked_hallucination", {phantom_cards, …})
              raise HallucinatedCardsError(phantom_cards, task_id)
          ── Completion does NOT mutate task state. The audit event is written first
             in its own write_txn (kanban_db.py:2400-2413).
       3. UPDATE tasks SET status='done', result=?, completed_at=?, claim_lock=NULL,
                          claim_expires=NULL, worker_pid=NULL
            WHERE id=? AND status IN ('running','ready','blocked')
          ── If expected_run_id passed, also AND current_run_id=? (kanban_db.py:2434-2448)
       4. _end_run(conn, task_id, outcome="completed", summary=…)
       5. _append_event(conn, task_id, "completed", {result_len, summary, verified_cards})
       6. _scan_prose_for_phantom_ids(conn, summary+result)  # advisory only, kanban_db.py:2300
          ── If summary mentions t_<hex> that doesn't exist, emit
             "suspected_hallucinated_references" event but DO NOT block.
       7. _clear_failure_counter(conn, task_id)
          ── Successful completion wipes the consecutive_failures counter.
       8. recompute_ready(conn)
          ── Promotes children whose parents are now all done.

[Worker subprocess exits 0]
[Dispatcher's next tick observes nothing — task is done. End.]
```

## Architectural decisions

### AD-1: SQLite WAL + `BEGIN IMMEDIATE` + CAS is the coordination primitive

- **Decision**: Atomic claim semantics via SQLite WAL mode, immediate-write transactions, and compare-and-swap on `tasks.status` + `tasks.claim_lock`. No external lock service, no distributed-locks library.
- **Evidence**: `kanban_db.py:61-68` (module docstring):

  ```
  Concurrency strategy: WAL mode + ``BEGIN IMMEDIATE`` for write
  transactions + compare-and-swap (CAS) updates on ``tasks.status`` and
  ``tasks.claim_lock``.  SQLite serializes writers via its WAL lock, so at
  most one claimer can win any given task.  Losers observe zero affected
  rows and move on -- no retry loops, no distributed-lock machinery.
  ```

  And `kanban_db.py:1922-1936` — the `UPDATE … WHERE id=? AND status='ready' AND claim_lock IS NULL` followed by `if cur.rowcount != 1: return None`.

- **Rationale**: SQLite already had to be in the picture for session/cron/etc. persistence. Reusing its writer-serialization gives kanban the same atomicity without operational overhead. CAS lets losers detect they lost via `rowcount == 0` without retry loops.

- **Alternative rejected**: Distributed locks (Redis, etcd) would have required external infrastructure, breaking "drop-in, runs on a $5 VPS" positioning. In-memory locks would have lost durability across process restarts.

- **TypeScript translation**: `better-sqlite3` is synchronous + WAL-capable. We get the same CAS guarantees with `db.prepare('UPDATE tasks SET … WHERE id=? AND status=? AND claim_lock IS NULL').run(…).changes === 1`. **Do not** use `sqlite3` (async) or Drizzle ORM here — both can introduce JS-level races between read and write that defeat CAS. The whole abstraction in `@usetheo/sdk` must be synchronous (under `Kanban.run`) or use the same statement-prepared CAS pattern.

### AD-2: `consecutive_failures` is unified across spawn/timeout/crash; reset only on success

- **Decision**: A single `tasks.consecutive_failures` column accumulates across *any* non-success outcome — spawn failure, timeout, crash. Reset to 0 only on successful completion (not on successful spawn).
- **Evidence**: `kanban_db.py:579-586`:

  ```python
  # Unified non-success counter. Incremented on any of:
  #   * spawn failure (dispatcher couldn't launch the worker)
  #   * timed_out outcome (worker exceeded max_runtime_seconds)
  #   * crashed outcome (worker PID vanished)
  # Reset to 0 only on a successful completion.
  consecutive_failures: int = 0
  ```

  And `kanban_db.py:3612-3627` (`_clear_failure_counter`):

  ```python
  """Reset the unified consecutive-failures counter.

  Called from ``complete_task`` on successful completion — a fresh
  success means the task + profile combination is working and any
  past failures are history. NOT called on spawn success anymore:
  a successful spawn proves the worker could start but says nothing
  about whether the run will succeed, so we need to let timeouts and
  crashes accumulate across spawn boundaries.
  """
  ```

- **Rationale**: A worker that spawns cleanly, runs for 5 minutes, then crashes is *not* a sign of a healthy task/profile combination. Earlier versions reset on successful spawn (PR #20410 unified them). Aggregating across all non-success outcomes ensures the breaker trips before the system spends days re-spawning a broken combination.

- **Alternative rejected**: Separate counters per outcome (`spawn_failures`, `timeout_failures`, `crash_failures`). The pre-#20410 code had `spawn_failures` only. After the rename, the migration code at `kanban_db.py:1024-1035` reads `COALESCE(spawn_failures, 0)` into the unified column.

- **TypeScript translation**: One counter, three increment paths (spawn-fail, timeout, crash), one reset on success. Per-task `maxRetries` override in `KanbanTask` type; global `kanban.failureLimit` config defaulting to `DEFAULT_FAILURE_LIMIT = 2` (per `kanban_db.py:2887`). API: `Kanban.create({ failureLimit: 2 })`.

### AD-3: 15-minute claim TTL + heartbeat — but if PID is alive, extend instead of reclaim

- **Decision**: Default claim TTL is 15 minutes. When TTL expires, the dispatcher does NOT reclaim if the worker's PID is still alive on this host — instead it *extends* the claim with a `claim_extended` event.
- **Evidence**: `kanban_db.py:97-101`:

  ```python
  # A running task's claim is valid for 15 minutes; after that the next
  # dispatcher tick reclaims it.  Workers that outlive this window should call
  # ``heartbeat_claim(task_id)`` periodically.  In practice most kanban
  # workloads either finish within 15m or set a longer claim explicitly.
  DEFAULT_CLAIM_TTL_SECONDS = 15 * 60
  ```

  And `kanban_db.py:2013-2024`:

  ```python
  """Reset any ``running`` task whose claim has expired.

  A stale-by-TTL claim whose host-local worker PID is still alive is
  *extended* (with a ``claim_extended`` event) instead of being
  reclaimed. Reclaiming a live worker mid-flight produces the spawn-
  then-immediately-reclaim loop seen on slow models that spend longer
  than ``DEFAULT_CLAIM_TTL_SECONDS`` inside a single tool-free LLM
  call (#23025): no tool calls means no ``kanban_heartbeat``, even
  though the subprocess is healthy."""
  ```

- **Rationale**: A model running a 20-minute LLM call without intermediate tool calls cannot heartbeat. Hard-reclaiming after 15 minutes would kill a working worker. The PID check is cheap (POSIX `kill(pid, 0)` returns 0 if alive) and prevents the false-positive loop.

- **Alternative rejected**: Reclaim immediately on TTL expiry. Tested in earlier versions; produced the spawn-reclaim loop described in issue #23025.

- **TypeScript translation**: `pidUsage`/`is-running` for cross-platform PID liveness. We will need `Kanban.heartbeat(taskId)` exposed as a tool the agent can call. Pure Node solution requires checking `process.kill(pid, 0)` in a try/catch — same as POSIX. Windows variant uses `taskkill /F /PID … /T` for termination but `process.kill(pid, 0)` still throws if not alive.

### AD-4: Hallucination gate verifies `created_cards` claims before allowing completion

- **Decision**: When a worker calls `kanban_complete(task_id, created_cards=[…])`, every id in the list is verified against three trust conditions. If any are phantom, completion is **rejected** with `HallucinatedCardsError` and an audit event is written.
- **Evidence**: `kanban_db.py:2333-2348`:

  ```python
  class HallucinatedCardsError(ValueError):
      """Raised by ``complete_task`` when ``created_cards`` contains ids
      that don't exist or weren't created by the completing worker.

      The phantom list is attached as ``.phantom`` for callers that want
      structured access. Kept as ``ValueError`` subclass so existing
      tool-error handlers treat it as a recoverable user error."""

      def __init__(self, phantom: list[str], completing_task_id: str):
          self.phantom = list(phantom)
          self.completing_task_id = completing_task_id
          super().__init__(
              f"completion blocked: claimed created_cards that do not exist "
              f"or were not created by this worker: {', '.join(phantom)}"
          )
  ```

  And the three trust conditions at `kanban_db.py:2226-2238`:

  ```
  A card is "verified" iff a row exists in ``tasks`` AND at least one
  of the following holds:

  * ``created_by`` matches the completing task's ``assignee`` profile
  * ``created_by`` matches the completing task's id
  * The card is linked as a ``task_links.child`` of the completing task
  ```

- **Rationale**: The release note for v0.13 (#20232) frames it: "Hallucination gate + recovery UX for worker-created-card claims (closes #20017)". An LLM worker can confidently claim "I created follow-up tasks t_aaaa, t_bbbb" while having created none of them. Without the gate, the completion succeeds and a phantom audit trail is left.

- **Alternative rejected**: A pure prose scan that simply flags suspicious-looking ids. That is now an *advisory* second check (`_scan_prose_for_phantom_ids` at `kanban_db.py:2300`, run *after* completion, emits `suspected_hallucinated_references` event, never blocks). The hard gate is the structured `created_cards` field.

- **TypeScript translation**: `Kanban.completeTask({ id, summary, result, createdCards })`. The `createdCards` array is checked against the same three rules. We throw a typed `HallucinatedCardsError` (extends our base `KanbanError`). Audit event is written *before* the throw, in a separate transaction, so the rejection is durable even if the caller swallows the error.

### AD-5: Single-process per worker; gateway-embedded dispatcher by default

- **Decision**: Each kanban task runs as a separate `hermes -p <assignee> chat` subprocess spawned by a long-lived dispatcher. The dispatcher runs **inside the gateway process** by default (`kanban.dispatch_in_gateway: true`).
- **Evidence**: AGENTS.md:812-818:

  > **Dispatcher:** long-lived loop that (default every 60s) reclaims
  > stale claims, promotes ready tasks, atomically claims, and spawns
  > assigned profiles. Runs **inside the gateway** by default via
  > `kanban.dispatch_in_gateway: true`.

  And `plugins/kanban/systemd/hermes-kanban-dispatcher.service` exists for standalone deployments (AGENTS.md:819-820).

- **Rationale**: Reuses the gateway's existing process supervision (systemd unit, restart-on-failure, log rotation). Single dispatcher means single source of truth for "what tasks have I just spawned" — no leader election.

- **Alternative rejected**: Workers self-claim (no dispatcher). Would require N+1 SQLite connections vying for claims even when 0 tasks are ready, polluting WAL. Hermes does support a standalone dispatcher (systemd unit), but the in-gateway default is the documented happy path.

- **TypeScript translation**: We will need *both* shapes for v1.3:
  - **In-process dispatcher**: `const kanban = await Kanban.create({ board: "default" }); await kanban.startDispatcher()` — suitable for users running TheoKit in a long-lived Node service.
  - **Single-shot tick**: `await kanban.tick()` — suitable for users running cron triggers from outside (Vercel scheduled functions, GitHub Actions). Cron mode does not need a continuously running process.

### AD-6: Worker-spawned subprocess gets pinned env vars; cannot see other boards

- **Decision**: The dispatcher injects `HERMES_KANBAN_BOARD`, `HERMES_KANBAN_DB`, `HERMES_KANBAN_WORKSPACES_ROOT`, `HERMES_KANBAN_TASK`, `HERMES_KANBAN_RUN_ID` into the worker subprocess environment. Workers cannot see other boards (defense in depth).
- **Evidence**: `kanban_db.py:49-53`:

  ```
  The dispatcher injects ``HERMES_KANBAN_DB``,
  ``HERMES_KANBAN_WORKSPACES_ROOT``, and ``HERMES_KANBAN_BOARD`` into
  worker subprocess env so workers converge on the exact DB the
  dispatcher used to claim their task — even under unusual symlink or
  Docker layouts.
  ```

  Worker-side check (`tools/kanban_tools.py:59-73`):

  ```python
  def _check_kanban_mode() -> bool:
      """Task-lifecycle tools are available when:
      1. ``HERMES_KANBAN_TASK`` is set (dispatcher-spawned worker), OR
      2. The current profile has ``kanban`` in its toolsets config
         (orchestrator profiles like techlead that route work via Kanban)."""
      if os.environ.get("HERMES_KANBAN_TASK"):
          return True
      return _profile_has_kanban_toolset()
  ```

- **Rationale**: The gateway has access to all boards; a worker spawned for a board-scoped task should not. Env-var injection at spawn time is the simplest way to scope the worker without exposing a "board" parameter to every tool call.

- **TypeScript translation**: Same shape — `Kanban` workers are spawned (via `child_process.spawn` or `worker_threads`) with `THEOKIT_KANBAN_*` env vars set. The worker constructs its `Kanban` instance from `THEOKIT_KANBAN_DB` env var if present; otherwise from the default path. We expose `Kanban.fromEnv()` static for workers, and `Kanban.create({ board })` for orchestrators.

### AD-7: `_enforce_worker_task_ownership` — workers cannot mutate foreign tasks

- **Decision**: When a worker calls `kanban_complete`, `kanban_block`, or `kanban_heartbeat` with a `task_id` that does not match the `HERMES_KANBAN_TASK` env var, the tool refuses.
- **Evidence**: `tools/kanban_tools.py:115-144`:

  ```python
  def _enforce_worker_task_ownership(tid: str) -> Optional[str]:
      """Reject worker-driven destructive calls on foreign task IDs.

      A process spawned by the dispatcher has ``HERMES_KANBAN_TASK`` set
      to its own task id. Tools like ``kanban_complete`` / ``kanban_block``
      / ``kanban_heartbeat`` mutate run-lifecycle state, so a buggy or
      prompt-injected worker that passed an explicit ``task_id`` for some
      other task could corrupt sibling or cross-tenant runs (see #19534)."""
      env_tid = os.environ.get("HERMES_KANBAN_TASK")
      if not env_tid:
          # Orchestrator or CLI context — no task-scope restriction.
          return None
      if tid != env_tid:
          return tool_error(
              f"worker is scoped to task {env_tid}; refusing to mutate "
              f"{tid}. Use kanban_comment to hand off information to other "
              f"tasks, or kanban_create to spawn follow-up work.")
      return None
  ```

- **Rationale**: Prompt-injection or model confusion can lead a worker to pass an arbitrary `task_id` when calling `kanban_complete`. Without this guard, worker A could close worker B's task. Issue #19534 documents this. Workers are *narrowly scoped*; cross-task communication is via `kanban_comment` (non-destructive) or `kanban_create` (creates new follow-ups).

- **TypeScript translation**: Same guard, same exception. The check happens inside the tool handler before any DB write, returns a structured error the LLM can recover from.

### AD-8: The `current_run_id` pointer + per-attempt `task_runs` rows

- **Decision**: Every claim/spawn creates a row in `task_runs`. The `tasks.current_run_id` column points to the active run. Closing a run sets `task_runs.ended_at` and clears `current_run_id`. Retries see multiple rows per task.
- **Evidence**: `kanban_db.py:832-852` (schema):

  ```sql
  CREATE TABLE IF NOT EXISTS task_runs (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id             TEXT NOT NULL,
      profile             TEXT,
      step_key            TEXT,
      status              TEXT NOT NULL,
      -- status: running | done | blocked | crashed | timed_out | failed | released
      claim_lock          TEXT,
      claim_expires       INTEGER,
      worker_pid          INTEGER,
      max_runtime_seconds INTEGER,
      last_heartbeat_at   INTEGER,
      started_at          INTEGER NOT NULL,
      ended_at            INTEGER,
      outcome             TEXT,
      -- outcome: completed | blocked | crashed | timed_out | spawn_failed |
      --          gave_up | reclaimed | (null while still running)
      summary             TEXT,
      metadata            TEXT,
      error               TEXT
  );
  ```

  And the comment at `kanban_db.py:677-685`:

  ```
  A run is one attempt to execute a task — created on claim, closed
  on complete/block/crash/timeout/spawn_failure/reclaim. Multiple runs
  per task when retries happen. Carries the claim machinery, PID,
  heartbeat, and the structured handoff summary that downstream workers
  read via ``build_worker_context``.
  ```

- **Rationale**: A single `tasks` row tracks the *current state*; the run rows track *attempt history*. Worker handoff via `summary` and `metadata` persists per-attempt. Subsequent retries can read prior runs' summaries.

- **Alternative rejected**: Single mutable row that overwrites on each retry. Loses attempt history; can't reason about why-was-this-retried.

- **TypeScript translation**: `Kanban.listRuns(taskId): KanbanRun[]`. Storage exactly as Hermes: parent `tasks` table + child `task_runs` table joined on `task_id`. The `current_run_id` denormalisation gives cheap reads.

### AD-9: Re-gate parent completion on every claim (defense in depth)

- **Decision**: `claim_task` re-checks the parent-completion invariant inside the transaction. If any parent is not `done` or `archived`, the claim is rejected AND the task is demoted from `ready` back to `todo`.
- **Evidence**: `kanban_db.py:1876-1900`:

  ```python
  # Structural invariant: never transition ready -> running while any
  # parent is not yet 'done'. This is the single enforcement point
  # regardless of which writer (create_task, link_tasks, unblock_task,
  # release_stale_claims, manual SQL) set status='ready'. If a racy
  # writer promoted a task with undone parents, demote it back to
  # 'todo' here — recompute_ready will re-promote when the parents
  # actually finish. See RCA at
  # kanban/boards/cookai/workspaces/t_a6acd07d/root-cause.md.
  ```

- **Rationale**: Many writers can set `status='ready'` (`create_task`, `link_tasks`, `unblock_task`, manual SQL, `recompute_ready`). Centralising the invariant check in `claim_task` means it cannot be bypassed. An RCA referenced in the comment confirms this was added after a real incident.

- **TypeScript translation**: Same shape — `claimTask()` re-checks parents before the CAS. Costs one extra SELECT per claim attempt, negligible.

### AD-10: Manual `reclaim_task` clears the failure counter; auto-reclaim does not

- **Decision**: An operator-triggered `reclaim_task` (the dashboard's "abort" button or `hermes kanban reclaim <id>`) clears `consecutive_failures` because the operator has *intervened* — a fresh budget is appropriate. Automatic stale-claim reclaim from `release_stale_claims` does *not* clear the counter.
- **Evidence**: `kanban_db.py:2180-2185`:

  ```python
  # Operator intervention — they've looked at the task, so the
  # consecutive-failures counter is now stale. Give the next retry
  # a fresh budget. (_clear_failure_counter opens its own write_txn,
  # so it runs after the enclosing one commits.)
  _clear_failure_counter(conn, task_id)
  ```

- **Rationale**: Operator inspection is a signal that the pathology (whatever caused the prior failures) is being investigated. Auto-reclaim is the *opposite* — it happens precisely because the worker died and the system has no insight, so the counter must keep accumulating.

- **TypeScript translation**: Two distinct methods: `Kanban.reclaimTask(id, { manual: true })` (clears counter) vs internal `dispatcher._reclaimStaleClaims()` (doesn't). The boolean is the policy.

### AD-11: Workspace kinds decouple coordination from git worktrees

- **Decision**: A task's `workspace_kind` is one of `{scratch, worktree, dir}`. The board does not require git worktrees.
- **Evidence**: `kanban_db.py:55-59`:

  ```
  Schema is intentionally small: tasks, task_links, task_comments,
  task_events.  The ``workspace_kind`` field decouples coordination from git
  worktrees so that research / ops / digital-twin workloads work alongside
  coding workloads.
  ```

  Constant at `kanban_db.py:94`: `VALID_WORKSPACE_KINDS = {"scratch", "worktree", "dir"}`.

- **Rationale**: Many kanban use cases are not coding tasks. A research worker grinding through papers, an ops worker monitoring infra — these need an *isolated workspace* but not a git worktree. `scratch` creates a fresh tmpdir; `dir` points at an existing path; `worktree` creates a git worktree under `boards/<slug>/workspaces/`.

- **TypeScript translation**: Same three modes. `KanbanTask.workspaceKind: "scratch" | "worktree" | "dir"`. `Kanban.resolveWorkspace(task)` returns the absolute path. The git-worktree creation is a separate concern wired in via `simple-git` or shelling to `git worktree add`.

### AD-12: Per-board isolation — multi-project users get separate DBs

- **Decision**: A single Hermes install can host multiple kanban boards. Each board has its own SQLite file under `<root>/kanban/boards/<slug>/kanban.db`. The default board keeps the legacy path `<root>/kanban.db` for back-compat.
- **Evidence**: `kanban_db.py:11-23`:

  ```
  **Multiple boards (projects):** users can create additional boards to
  separate unrelated streams of work (e.g. one per project / repo / domain).
  Each board is a directory under ``<root>/kanban/boards/<slug>/`` with
  its own ``kanban.db``, ``workspaces/``, and ``logs/``. All boards share
  the profile's Hermes home but are otherwise isolated: a worker spawned
  for a task on board ``atm10-server`` sees only that board's tasks,
  cannot enumerate other boards, and its dispatcher ticks don't touch
  other boards' DBs.
  ```

- **Rationale**: A backlog for "my SaaS app" and "weekend Minecraft modding" should not pollute each other's task lists. Per-board DBs cleanly partition the data and inherit CAS atomicity per file.

- **TypeScript translation**: `Kanban.create({ board: "atm10-server" })` opens a board-specific DB. `Kanban.listBoards()` enumerates. Board slug validation copies `_BOARD_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9\-_]{0,63}$")` at `kanban_db.py:127`.

## Data structures

### Persisted

**Path**: `<HERMES_HOME>/kanban.db` (default board, legacy back-compat) or `<HERMES_HOME>/kanban/boards/<slug>/kanban.db` (other boards). The resolution chain (highest precedence first) is at `kanban_db.py:281-303`:

1. `HERMES_KANBAN_DB` env var
2. `board` argument passed to `connect()` / `init_db()`
3. `HERMES_KANBAN_BOARD` env var
4. `<root>/kanban/current` text file
5. `DEFAULT_BOARD = "default"`

**Format**: SQLite with WAL mode (`kanban_db.py:892-940` `connect()` enables `PRAGMA journal_mode=WAL`, `PRAGMA busy_timeout=5000`, `PRAGMA foreign_keys=ON`).

**Schema**: Verbatim from `kanban_db.py:753-882` (SCHEMA_SQL constant).

```sql
CREATE TABLE tasks (
    id                   TEXT PRIMARY KEY,    -- "t_<12 hex>"
    title                TEXT NOT NULL,
    body                 TEXT,
    assignee             TEXT,                -- Hermes profile name
    status               TEXT NOT NULL,       -- triage | todo | ready | running | blocked | done | archived
    priority             INTEGER DEFAULT 0,
    created_by           TEXT,
    created_at           INTEGER NOT NULL,    -- unix epoch
    started_at           INTEGER,             -- first-ever start; survives retries
    completed_at         INTEGER,
    workspace_kind       TEXT NOT NULL DEFAULT 'scratch',
    workspace_path       TEXT,
    claim_lock           TEXT,                -- "<host>:<random>"
    claim_expires        INTEGER,
    tenant               TEXT,                -- soft tenant namespace
    result               TEXT,
    idempotency_key      TEXT,                -- unique (when set) to dedupe creation
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    worker_pid           INTEGER,
    last_failure_error   TEXT,
    max_runtime_seconds  INTEGER,
    last_heartbeat_at    INTEGER,
    current_run_id       INTEGER,
    workflow_template_id TEXT,
    current_step_key     TEXT,
    skills               TEXT,                -- JSON array of skill names
    max_retries          INTEGER              -- per-task circuit-breaker override
);

CREATE TABLE task_links (parent_id TEXT, child_id TEXT, PRIMARY KEY (parent_id, child_id));
CREATE TABLE task_comments (id INTEGER PRIMARY KEY, task_id TEXT, author TEXT, body TEXT, created_at INTEGER);
CREATE TABLE task_events (id INTEGER PRIMARY KEY, task_id TEXT, run_id INTEGER, kind TEXT, payload TEXT, created_at INTEGER);

CREATE TABLE task_runs (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id             TEXT NOT NULL,
    profile             TEXT,
    step_key            TEXT,
    status              TEXT NOT NULL,        -- running | done | blocked | crashed | timed_out | failed | released
    claim_lock          TEXT,
    claim_expires       INTEGER,
    worker_pid          INTEGER,
    max_runtime_seconds INTEGER,
    last_heartbeat_at   INTEGER,
    started_at          INTEGER NOT NULL,
    ended_at            INTEGER,
    outcome             TEXT,                  -- completed | blocked | crashed | timed_out | spawn_failed | gave_up | reclaimed | null
    summary             TEXT,
    metadata            TEXT,                  -- JSON object
    error               TEXT
);

CREATE TABLE kanban_notify_subs (   -- gateway notifier subscriptions
    task_id          TEXT, platform TEXT, chat_id TEXT, thread_id TEXT DEFAULT '',
    user_id          TEXT, notifier_profile TEXT, created_at INTEGER NOT NULL,
    last_event_id    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (task_id, platform, chat_id, thread_id)
);

-- Indexes
CREATE INDEX idx_tasks_assignee_status ON tasks(assignee, status);
CREATE INDEX idx_tasks_status          ON tasks(status);
CREATE INDEX idx_tasks_tenant          ON tasks(tenant);
CREATE INDEX idx_tasks_idempotency     ON tasks(idempotency_key);
CREATE INDEX idx_links_child           ON task_links(child_id);
CREATE INDEX idx_links_parent          ON task_links(parent_id);
CREATE INDEX idx_comments_task         ON task_comments(task_id, created_at);
CREATE INDEX idx_events_task           ON task_events(task_id, created_at);
CREATE INDEX idx_events_run            ON task_events(run_id, id);
CREATE INDEX idx_runs_task             ON task_runs(task_id, started_at);
CREATE INDEX idx_runs_status           ON task_runs(status);
CREATE INDEX idx_notify_task           ON kanban_notify_subs(task_id);
```

**Lifecycle**:
- `init_db(board)` creates the file + schema. Idempotent.
- `_migrate_add_optional_columns()` is called on every `connect()` and handles legacy schema bumps (`spawn_failures` → `consecutive_failures`, `last_spawn_error` → `last_failure_error`, addition of `max_retries`, etc.) at `kanban_db.py:989-1090`.
- Writers serialize via SQLite's WAL writer lock.

**Other on-disk artifacts**:
- `<root>/kanban/boards/<slug>/board.json` — display metadata (name, color, icon, archived, created_at). Schema at `kanban_db.py:365-396` (`read_board_metadata`).
- `<root>/kanban/boards/<slug>/workspaces/<task_id>/` — per-task workspace directories. Created by `resolve_workspace(task)` at `kanban_db.py:2805`.
- `<root>/kanban/boards/<slug>/logs/<task_id>.log` — per-task worker stdout/stderr (`worker_log_path` at `kanban_db.py:4616`).
- `<root>/kanban/current` — single-line text file with the active board slug (`get_current_board` at `kanban_db.py:189`).

### In-memory

`@dataclass` shapes at `kanban_db.py:558-746`:

```python
@dataclass
class Task:
    id: str
    title: str
    body: Optional[str]
    assignee: Optional[str]
    status: str
    priority: int
    created_by: Optional[str]
    created_at: int
    started_at: Optional[int]
    completed_at: Optional[int]
    workspace_kind: str
    workspace_path: Optional[str]
    claim_lock: Optional[str]
    claim_expires: Optional[int]
    tenant: Optional[str]
    result: Optional[str] = None
    idempotency_key: Optional[str] = None
    consecutive_failures: int = 0
    worker_pid: Optional[int] = None
    last_failure_error: Optional[str] = None
    max_runtime_seconds: Optional[int] = None
    last_heartbeat_at: Optional[int] = None
    current_run_id: Optional[int] = None
    workflow_template_id: Optional[str] = None
    current_step_key: Optional[str] = None
    skills: Optional[list] = None
    max_retries: Optional[int] = None

@dataclass
class Run:
    id: int
    task_id: str
    profile: Optional[str]
    step_key: Optional[str]
    status: str
    claim_lock: Optional[str]
    claim_expires: Optional[int]
    worker_pid: Optional[int]
    max_runtime_seconds: Optional[int]
    last_heartbeat_at: Optional[int]
    started_at: int
    ended_at: Optional[int]
    outcome: Optional[str]
    summary: Optional[str]
    metadata: Optional[dict]
    error: Optional[str]

@dataclass
class Comment:
    id: int
    task_id: str
    author: str
    body: str
    created_at: int

@dataclass
class Event:
    id: int
    task_id: str
    kind: str               # "created" | "claimed" | "spawned" | "completed" | "blocked"
                            # | "reclaimed" | "timed_out" | "crashed" | "gave_up"
                            # | "claim_extended" | "claim_rejected"
                            # | "completion_blocked_hallucination"
                            # | "suspected_hallucinated_references"
                            # | "edited"
    payload: Optional[dict]
    created_at: int
    run_id: Optional[int] = None
```

### Concurrency model

- **Writer serialization** via SQLite WAL (`PRAGMA journal_mode=WAL`, `kanban_db.py:892`+).
- **Write transactions** use `BEGIN IMMEDIATE` via the `write_txn` context manager (`kanban_db.py:1173`).
- **CAS pattern** on every state-mutating write: `UPDATE … WHERE id=? AND status=? [AND claim_lock=? [AND current_run_id=?]]`, then check `cur.rowcount == 1`.
- **No external lock service.** Module docstring (line 65) explicitly: "no retry loops, no distributed-lock machinery."
- **No `asyncio.Lock`s.** This is purely a Python-blocking-IO module. Concurrency happens *between* processes (multiple Hermes workers), not within one.
- **PID liveness checks** via `_pid_alive(pid)` at `kanban_db.py:2993` (POSIX `os.kill(pid, 0)`).

## Failure modes Hermes already fixed

These are the documented edge cases the v0.13 implementation already handles. Each MUST be reproduced in our TypeScript port.

### 1. Spawn-reclaim infinite loop on slow models (issue #23025)

- **What can go wrong**: A model makes a 20-minute LLM call (e.g. reasoning model) with no intermediate tool calls. The worker cannot call `kanban_heartbeat` (no tool-call boundary). After 15 minutes, claim TTL expires. The dispatcher reclaims, spawns again, the new worker takes another 20 minutes, fails the same way.
- **How Hermes handles it**: `release_stale_claims` checks if the original worker's PID is still alive on this host. If so, it *extends* the claim by another 15 minutes and emits a `claim_extended` event instead of reclaiming. `kanban_db.py:2036-2074`. Confirmed in the docstring at `kanban_db.py:2013-2024`.
- **Evidence this happened**: Comment cites issue #23025.

### 2. Worker mutates foreign tasks via prompt injection (issue #19534)

- **What can go wrong**: A buggy or prompt-injected worker passes an explicit `task_id` for some other task to `kanban_complete`, corrupting sibling or cross-tenant runs.
- **How Hermes handles it**: `_enforce_worker_task_ownership` at `tools/kanban_tools.py:115-144` compares the passed `task_id` against `HERMES_KANBAN_TASK` and returns a structured `tool_error` if they differ.
- **Evidence this happened**: Comment at `tools/kanban_tools.py:121` cites issue #19534.

### 3. Phantom card hallucinations on completion (#20232, closes #20017)

- **What can go wrong**: A worker calls `kanban_complete(task_id, created_cards=["t_aaaa", "t_bbbb"])` claiming to have spawned follow-ups, but none of those task ids exist (model made them up).
- **How Hermes handles it**: `_verify_created_cards` at `kanban_db.py:2219-2291` checks each id against three trust conditions. Phantom ids trigger `HallucinatedCardsError`; an audit event is written first. `kanban_db.py:2333-2348`.
- **Evidence this happened**: Class docstring at `kanban_db.py:2333`. RELEASE_v0.13.0.md PR #20232 "Hallucination gate + recovery UX for worker-created-card claims (closes #20017)".

### 4. Promoted-too-early to `ready` while parents not done

- **What can go wrong**: A racy writer flips a task to `ready` before all parents have completed. Without re-checking, `claim_task` would happily transition `ready → running` and let the worker start without its dependencies' results.
- **How Hermes handles it**: `claim_task` at `kanban_db.py:1885-1900` re-checks the parent-completion invariant inside the claim transaction. If any parent is not done/archived, the task is demoted back to `todo` and a `claim_rejected` event is emitted.
- **Evidence this happened**: Comment at `kanban_db.py:1883-1884` references "RCA at kanban/boards/cookai/workspaces/t_a6acd07d/root-cause.md" — an internal incident report.

### 5. Stale `current_run_id` pointer from a leaked run

- **What can go wrong**: If a writer somehow set `tasks.status='ready'` while `tasks.current_run_id` still pointed at a not-yet-closed `task_runs` row, the next `claim_task` would create a *new* run row, stranding the old one.
- **How Hermes handles it**: `claim_task` at `kanban_db.py:1902-1921` SELECTs the current run before CAS; if non-null, it closes the leaked run as `reclaimed` with a synthesized `summary` ("invariant recovery on re-claim") inside the same transaction.
- **Evidence this happened**: Defensive comment at `kanban_db.py:1903-1905` ("Defensive: if a prior run somehow leaked … No-op when the invariant holds").

### 6. SIGTERM/SIGKILL escalation for runaway workers

- **What can go wrong**: A worker exceeds its `max_runtime_seconds` (e.g. 1 hour cap, took 3 hours). Just freeing the row doesn't kill the subprocess — it keeps consuming CPU + model tokens.
- **How Hermes handles it**: `enforce_max_runtime` at `kanban_db.py:3164-3274` sends `SIGTERM`, polls for 5 seconds (10 × 0.5s sleeps), then `SIGKILL` if still alive. Records `timed_out` event with `sigkill: True/False` in payload.
- **Evidence this happened**: Implementation detail in PR #21183 "Heartbeat + reclaim + zombie + retry-cap fixes (#21147, #21141, #21169, #20881)" per RELEASE_v0.13.0.md:95.

### 7. Crashed worker PID is reused by unrelated process

- **What can go wrong**: A worker's PID vanishes (crash). Detect-crashed-workers checks `_pid_alive(pid)`, but on Linux PIDs are recycled. By the time the dispatcher tick runs, another process may have the same PID — a false-positive "alive" check would *miss the crash*.
- **How Hermes handles it**: `detect_crashed_workers` at `kanban_db.py:3292-3417` includes host-local filtering (only checks PIDs whose `claim_lock` starts with this host's prefix; `kanban_db.py:host_prefix = f"{_claimer_id().split(':', 1)[0]}:"`). Crashed-worker detection only considers tasks claimed by this host, where PID semantics are local. Additionally, `_record_worker_exit` at `kanban_db.py:2935` tracks exit codes from SIGCHLD when possible.

### 8. Darwin zombies (per RELEASE_v0.13.0.md PR #20188)

- **What can go wrong**: macOS specifics cause kanban workers to enter zombie state without proper SIGCHLD handling.
- **How Hermes handles it**: Specific darwin-zombie detection landed in PR #20188 ("Detect darwin zombie workers (salvages #20023)"). The crashed-worker detection at `kanban_db.py:3292` is OS-aware via `_pid_alive` and `_classify_worker_exit` (`kanban_db.py:2958`).

### 9. Auto-block after `DEFAULT_FAILURE_LIMIT=2` consecutive failures

- **What can go wrong**: A task assigned to a profile whose model has a permanent issue would re-spawn forever without progress.
- **How Hermes handles it**: `_record_task_failure` at `kanban_db.py:3419-3570` increments `consecutive_failures` and, when it reaches the effective limit, transitions `ready → blocked` and emits a `gave_up` event. Default is **2** (`DEFAULT_FAILURE_LIMIT = 2` at `kanban_db.py:2887`). Per-task override: `tasks.max_retries`.
- **Evidence this happened**: RELEASE_v0.13.0.md highlight: "After ~5 consecutive spawn failures on the same task the dispatcher auto-blocks it to prevent spin loops" (AGENTS.md:828-830 mentions 5; the in-code default is 2 with config override — investigate as open question below).

### 10. Manual reclaim must clear the failure counter

- **What can go wrong**: An operator reclaims a stuck running task. If the counter persists, the next retry uses up a budget the operator did not intend to consume.
- **How Hermes handles it**: `reclaim_task` at `kanban_db.py:2184` calls `_clear_failure_counter`. Comment at `kanban_db.py:2180-2183` is explicit: "Operator intervention — they've looked at the task, so the consecutive-failures counter is now stale."

### 11. Race between reclaim and live worker still committing

- **What can go wrong**: TTL expires → dispatcher reclaims → original worker (slow but not dead) finally calls `kanban_complete`. Without protection, the late completion would land on a re-claimed task.
- **How Hermes handles it**: `complete_task` accepts an optional `expected_run_id` parameter (`kanban_db.py:2359`). When the worker passes its run id, the update gate `AND current_run_id = ?` makes the completion no-op if the run was already reclaimed. `kanban_db.py:2434-2448`.

### 12. Prose-scan for `t_<hex>` references that don't exist

- **What can go wrong**: A completed summary mentions `t_deadbeef` ("see follow-up t_deadbeef for the rest"), but t_deadbeef does not exist. The completion is *valid* (the structured `created_cards` was empty), but the summary hallucinates downstream work.
- **How Hermes handles it**: `_scan_prose_for_phantom_ids` at `kanban_db.py:2300-2330` runs *after* a successful completion, regex-matches `\bt_[a-f0-9]{8,}\b`, and emits a `suspected_hallucinated_references` event. Advisory only — never blocks. `kanban_db.py:2486-2506`.

### 13. The kanban revert/reimplement saga itself

- **What can go wrong**: The kanban feature was *too ambitious* in v0.12 (#16081 landed, #16098 reverted "while the design is reworked" — per RELEASE_v0.12.0.md:438).
- **How Hermes handles it**: v0.13 #17805 reimplemented as "durable multi-profile collaboration board, post-revert reimplementation, multi-profile by design" (RELEASE_v0.13.0.md:73). The lesson: kanban is harder than it looks; ship the simplest working version first.

## TypeScript API proposal

### Public surface (added to `@usetheo/sdk`)

```typescript
// src/index.ts — public exports
export { Kanban } from "./kanban";
export type {
  KanbanOptions,
  KanbanTask,
  KanbanRun,
  KanbanComment,
  KanbanEvent,
  KanbanTaskStatus,
  KanbanWorkspaceKind,
  KanbanEventKind,
} from "./kanban/types";
export { KanbanError, HallucinatedCardsError, ClaimRejectedError } from "./kanban/errors";

// src/kanban/index.ts
export class Kanban {
  // ---- Static factory --------------------------------------------------
  static async create(options: KanbanOptions): Promise<Kanban>;
  static async fromEnv(): Promise<Kanban>;  // For dispatcher-spawned workers
  static async listBoards(opts?: { theokitHome?: string }): Promise<BoardMetadata[]>;
  static async createBoard(slug: string, meta?: Partial<BoardMetadata>): Promise<BoardMetadata>;

  // ---- Task CRUD --------------------------------------------------------
  async createTask(input: CreateTaskInput): Promise<KanbanTask>;
  async getTask(id: TaskId): Promise<KanbanTask | null>;
  async listTasks(filter?: TaskFilter): Promise<KanbanTask[]>;
  async assignTask(id: TaskId, profile: string | null): Promise<boolean>;
  async linkTasks(parentId: TaskId, childId: TaskId): Promise<void>;
  async unlinkTasks(parentId: TaskId, childId: TaskId): Promise<boolean>;
  async addComment(id: TaskId, author: string, body: string): Promise<KanbanComment>;
  async archiveTask(id: TaskId): Promise<boolean>;

  // ---- Lifecycle (CAS state transitions) --------------------------------
  async claimTask(id: TaskId, opts?: { ttlSeconds?: number; claimer?: string }): Promise<KanbanTask | null>;
  async heartbeat(id: TaskId, opts?: { ttlSeconds?: number }): Promise<boolean>;
  async releaseStaleClaims(opts?: { signalFn?: (pid: number, sig: NodeJS.Signals) => void }): Promise<number>;
  async reclaimTask(id: TaskId, opts: { reason: string }): Promise<boolean>;
  async completeTask(id: TaskId, opts: CompleteTaskOptions): Promise<boolean>;
  async blockTask(id: TaskId, opts: { reason: string; expectedRunId?: number }): Promise<boolean>;
  async unblockTask(id: TaskId): Promise<boolean>;

  // ---- Runs (attempt history) -------------------------------------------
  async listRuns(taskId: TaskId): Promise<KanbanRun[]>;
  async listComments(taskId: TaskId): Promise<KanbanComment[]>;
  async listEvents(taskId: TaskId, opts?: { since?: number; limit?: number }): Promise<KanbanEvent[]>;

  // ---- Worker context (for spawned workers) -----------------------------
  buildWorkerContext(taskId: TaskId): Promise<string>;

  // ---- Dispatcher (long-lived loop) -------------------------------------
  startDispatcher(opts?: DispatcherOptions): Promise<DispatcherHandle>;
  async tick(): Promise<TickReport>;  // Single-shot tick — for serverless / cron-driven hosts

  // ---- Disposal ---------------------------------------------------------
  async [Symbol.asyncDispose](): Promise<void>;
  async dispose(): Promise<void>;
}

// src/kanban/types.ts
export type TaskId = `t_${string}`;
export type KanbanTaskStatus = "triage" | "todo" | "ready" | "running" | "blocked" | "done" | "archived";
export type KanbanWorkspaceKind = "scratch" | "worktree" | "dir";

export type KanbanEventKind =
  | "created" | "claimed" | "spawned" | "completed" | "blocked"
  | "reclaimed" | "timed_out" | "crashed" | "gave_up"
  | "claim_extended" | "claim_rejected"
  | "completion_blocked_hallucination"
  | "suspected_hallucinated_references"
  | "edited";

export interface KanbanOptions {
  board?: string;                  // slug; defaults to "default"
  dbPath?: string;                 // explicit DB path override (~ HERMES_KANBAN_DB)
  failureLimit?: number;           // default 2 (matches Hermes DEFAULT_FAILURE_LIMIT)
  defaultClaimTtlSeconds?: number; // default 900 (15 min)
}

export interface KanbanTask {
  id: TaskId;
  title: string;
  body: string | null;
  assignee: string | null;
  status: KanbanTaskStatus;
  priority: number;
  createdBy: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  workspaceKind: KanbanWorkspaceKind;
  workspacePath: string | null;
  claimLock: string | null;
  claimExpires: number | null;
  tenant: string | null;
  result: string | null;
  idempotencyKey: string | null;
  consecutiveFailures: number;
  workerPid: number | null;
  lastFailureError: string | null;
  maxRuntimeSeconds: number | null;
  lastHeartbeatAt: number | null;
  currentRunId: number | null;
  skills: string[] | null;
  maxRetries: number | null;
}

export interface CompleteTaskOptions {
  result?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
  createdCards?: TaskId[];        // Verified before completion — phantom triggers HallucinatedCardsError
  expectedRunId?: number;          // CAS gate against late completion after reclaim
}

export interface DispatcherOptions {
  intervalSeconds?: number;       // default 60
  spawnFn?: SpawnFn;              // injected: how to launch a worker subprocess
}
```

### Internal module layout

```
packages/sdk/src/kanban/
├── index.ts            # Public Kanban class — orchestrator
├── types.ts            # Public type contract (KanbanTask, KanbanRun, etc.)
├── errors.ts           # KanbanError + HallucinatedCardsError + ClaimRejectedError
├── db/
│   ├── connection.ts   # better-sqlite3 setup + PRAGMA journal_mode=WAL
│   ├── schema.sql      # Verbatim of kanban_db.py:753-882
│   ├── migrate.ts      # Schema migrations (consecutive_failures, max_retries column adds)
│   └── statements.ts   # Prepared statements as readonly constants
├── claim/
│   ├── claim-task.ts          # claim_task CAS
│   ├── heartbeat-claim.ts     # heartbeat_claim CAS
│   ├── release-stale.ts       # release_stale_claims (PID-alive check)
│   ├── reclaim.ts             # reclaim_task (manual)
│   └── enforce-max-runtime.ts # SIGTERM/SIGKILL escalation
├── complete/
│   ├── complete-task.ts       # complete_task (CAS + audit)
│   ├── verify-cards.ts        # _verify_created_cards — hallucination gate
│   └── scan-prose.ts          # _scan_prose_for_phantom_ids — advisory only
├── dispatcher/
│   ├── dispatcher.ts          # startDispatcher + tick loop
│   ├── spawn.ts               # Default subprocess spawn
│   ├── detect-crashed.ts      # detect_crashed_workers (PID liveness)
│   └── recompute-ready.ts     # Promote 'todo' → 'ready' when parents 'done'
├── records/
│   ├── failure.ts             # _record_task_failure (circuit breaker)
│   ├── runs.ts                # task_runs CRUD + _end_run + _synthesize_ended_run
│   └── events.ts              # _append_event
├── boards/
│   ├── paths.ts               # kanban_home, kanban_db_path, workspaces_root
│   ├── metadata.ts            # board.json read/write
│   └── enumerate.ts           # list_boards
└── worker-context/
    └── build.ts               # build_worker_context with the 4KB/8KB/2KB caps
```

### Persistence layout

Matches Hermes' layout 1:1, with `.theokit/` instead of `.hermes/`:

```
~/.theokit/
├── kanban.db                                # default board (back-compat path)
├── kanban/
│   ├── current                              # active board slug
│   ├── workspaces/<task_id>/                # default board scratch workspaces
│   ├── logs/<task_id>.log                   # default board per-task worker logs
│   └── boards/
│       └── <slug>/
│           ├── kanban.db                    # board-specific DB
│           ├── board.json                   # display metadata
│           ├── workspaces/<task_id>/
│           └── logs/<task_id>.log
```

Resolution chain matches Hermes (`kanban_db.py:281-303`): `dbPath` arg > `THEOKIT_KANBAN_DB` env > board-specific path. For SDK callers, `Kanban.create({ board })` is the primary surface; env vars are honoured for back-compat with dispatcher-spawned workers.

### Optional peer dependencies

| Dep | Why | When required |
|---|---|---|
| `better-sqlite3` | Synchronous SQLite + WAL (essential for CAS) | Always — kanban requires it. Peer dep, install if you use kanban. |
| `simple-git` | Worktree creation for `workspaceKind: "worktree"` | Only if user creates worktree tasks. Lazy import. |
| `proper-lockfile` | Cross-process file lock for board.json writes | Always — small foot, internal use. We bundle it inline if possible. |

### Migration impact on v1.2 users

- **Backward-compatible**: Yes. Kanban is a *new namespace*; no existing v1.2 API changes.
- **Breaking signature changes**: None.
- **Migration path**: Users opt in by calling `Kanban.create()`. Existing `Agent`, `Memory`, `Cron` APIs unchanged.
- **Required configuration**: For multi-process (orchestrator + workers) setups, users must install `@usetheo/sdk` in *both* the orchestrator and worker processes, and the worker must invoke `Kanban.fromEnv()` not `Kanban.create()`.

## Test strategy (mirrors Hermes' approach)

Hermes test files we will port directly:

- `tests/stress/test_concurrency.py` (302 LoC) — single-process claim races
- `tests/stress/test_concurrency_reclaim_race.py` (241 LoC) — reclaim vs late-completion races
- `tests/stress/test_concurrency_parent_gate.py` (183 LoC) — parent-completion invariant
- `tests/stress/test_concurrency_mixed.py` (350 LoC) — mixed scenarios
- `tests/stress/test_property_fuzzing.py` (283 LoC) — Hypothesis-style fuzz; we'll port via `fast-check`
- `tests/stress/test_benchmarks.py` (221 LoC) — perf regression detection
- `tests/stress/test_atypical_scenarios.py` (1060 LoC) — edge cases (zombie PIDs, stale locks, claim_extended timing)
- `tests/stress/test_subprocess_e2e.py` (228 LoC) — full subprocess spawn-claim-complete E2E
- `tests/hermes_cli/test_kanban_core_functionality.py` — happy-path unit tests
- `tests/hermes_cli/test_kanban_diagnostics.py` — distress detection
- `tests/tools/test_kanban_tools.py` — tool-handler unit tests

**Unit tests**:
- Every CAS function tested with: (a) success, (b) wrong status, (c) wrong claim_lock, (d) wrong current_run_id.
- `_verify_created_cards`: all 3 trust conditions × all combinations of phantom/valid.
- `_record_task_failure`: counter increments correctly under per-task override vs config default.

**Integration tests** (real SQLite, no mocks):
- Full claim → heartbeat → complete cycle with simulated dispatcher.
- Simulated PID-alive vs PID-dead reclaim behavior using a real fork.
- Parent gate: create parent + child, attempt to claim child before parent done, verify demotion to 'todo'.

**Property tests** (`fast-check`):
- For any sequence of valid operations (create/assign/claim/heartbeat/complete/block/reclaim), the database is always in a consistent state: no task has `status='running'` without a non-null `claim_lock`.
- For any concurrent N-claimer scenario, at most one claimer wins.

**Real-LLM tests** (per `.claude/rules/real-llm-validation.md`):
- Spawn an actual TheoKit worker on a real LLM, give it a real task ("write a hello-world script"), assert it completes and reports `created_cards` honestly.
- A second test where we prompt-inject the worker to claim phantom cards; assert the hallucination gate trips and the task remains running.

**Examples to ship** (under `examples/kanban-*`):
1. `examples/kanban-quickstart/` — one orchestrator, one worker, single task end-to-end.
2. `examples/kanban-multi-board/` — two boards isolated, prove no cross-contamination.
3. `examples/kanban-hallucination-gate/` — deliberately provoke the gate, show recovery UX.

## Open questions

- **DEFAULT_FAILURE_LIMIT — is it 2 or 5?** `kanban_db.py:2887` says `DEFAULT_FAILURE_LIMIT = 2`. AGENTS.md:828-830 says "~5 consecutive spawn failures". Likely the AGENTS.md text is stale (predates PR #20410 rename); the code is authoritative. Verify with `_record_task_failure` test or runtime check before finalising the SDK default.
- **`workflow_template_id` / `current_step_key` / `step_key`**: AGENTS.md is silent. Schema has them, but `kanban_db.py:785-789` says they're "v2 workflow routing", currently nullable and unused by the kernel. Do we ship the columns + types for forward-compat, or omit until v1.4?
- **`tenant` field**: Schema has it, `kanban_db.py:813-816` calls it "soft namespace within a board". Use cases? Should our `KanbanTask.tenant` be public API or internal?
- **`idempotency_key`**: Schema has it indexed. We need to surface this in `createTask({ idempotencyKey })` to prevent duplicate-creation under retry. How does it interact with the unique constraint — does Hermes treat duplicate creates as no-ops or as errors?
- **`kanban_specify.py` (266 LoC)**: I did not deep-read this file. It seems to attach specifications to triage tasks. Is it needed for v1.3 or can we defer?
- **`kanban_diagnostics.py` (776 LoC)**: Generic distress-signal detector. The release note (PR #20332) says it powers "auto-block workers that exit without completing". I need to read it for the full failure-mode catalog before locking the spec.
- **Dispatcher inside vs outside the SDK consumer's main loop**: Hermes' dispatcher is gateway-embedded. For Node users, do we provide a sidecar process (`npx theokit kanban dispatch`), an in-process API (`kanban.startDispatcher()`), or both?

## References

- Hermes file paths cited above (all under `referencia/hermes-agent/`)
- `referencia/hermes-agent/RELEASE_v0.12.0.md:438` — kanban revert
- `referencia/hermes-agent/RELEASE_v0.13.0.md:71-115` — kanban reimplementation + worker lifecycle PRs
- `referencia/hermes-agent/AGENTS.md:797-833` — kanban architecture summary
- Theokit ADRs this domain interacts with:
  - D8 — Cron persistence (JSON + atomic write) — kanban uses SQLite + WAL, a different shape.
  - D24 — `defineTool` schema source (Zod) — kanban tools will use the same `defineTool` helper.
  - D25 — `Agent.builder()` API shape — not directly used; kanban is a separate namespace.
