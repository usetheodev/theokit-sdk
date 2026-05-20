# 03 — Autonomous Skill Creation (Background Review Fork + Curator)

> Hermes does not have a single `Memory.proposeSkill()` API. Instead, two
> coupled subsystems together produce autonomous skill creation: (1) the
> **background review fork** in `run_agent.py:_spawn_background_review` —
> after a turn completes, the kernel forks the AIAgent with restricted
> toolsets and asks it "what should we save?"; (2) the **Curator** in
> `agent/curator.py:run_curator_review` — a periodic (default every 7 days)
> sweep that grades, consolidates, and prunes agent-created skills. Both run
> through the auxiliary client, both write to the same `~/.hermes/skills/`
> tree, both inherit the parent's prompt cache and credentials. In
> TypeScript: `Memory.spawnBackgroundReview()` (kernel-driven after each
> turn) plus `Skills.runCurator()` (operator-driven periodic).

## What problem this domain solves

Two distinct problems, solved by two distinct subsystems that share infrastructure:

**Problem 1 (per-turn)**: an agent just completed a substantive task. Buried in the conversation are *durable* facts (the user prefers TypeScript over JavaScript) and *durable* procedures (how to set up the project's test runner). Without intervention these die when the session ends. The kernel needs to fire a fast, scoped review *after the turn* that decides: should we update memory? Should we create or patch a skill? Without burdening the user, without breaking prompt cache, without invoking the main agent loop.

**Problem 2 (per-week)**: 90 days into using Hermes, the user has 200 agent-created skills. Half are duplicates ("test-runner", "test_runner", "run-the-tests"). Some are stale (never used since v0.5). Some should be consolidated under an umbrella. Some have rotted (paths changed, dependencies removed). Without intervention the skill folder degrades into a junk drawer. The kernel needs a *periodic curator* that grades the collection, consolidates by similarity, archives the stale, and reports what it did.

Both solutions share a forked-AIAgent pattern: the kernel spawns a *second* agent with the parent's credentials and prompt-cache key but a *narrower* toolset (memory + skills only). The fork operates against shared state and surfaces a one-line summary. The fork's prose output never reaches the user — only the structured tool calls it makes.

## Hermes file layout

| File | LoC | Role |
|---|---|---|
| `run_agent.py:4168-4500` | ~330 (within 16k file) | `_summarize_background_review_actions` + `_spawn_background_review` — the after-turn fork. |
| `agent/curator.py` | 1781 | Curator orchestrator: state, auto-transitions, LLM review, reports. |
| `agent/curator_backup.py` | 693 | Pre-run snapshot/restore for the curator (tar.gz of `~/.hermes/skills/`). |
| `hermes_cli/curator.py` | 598 | `hermes curator …` CLI: status, run, pause, resume, archive, prune, list-archived, restore. |
| `tools/skill_usage.py` | 609 | `.usage.json` sidecar — per-skill `use_count`, `view_count`, `patch_count`, `last_*_at`, `state`, `pinned`. |
| `tools/skill_manager_tool.py` | 931 | `skill_manage` tool: write/patch/archive/pin/list. The agent uses this. Refuses on bundled/hub skills (defense-in-depth). |
| `tests/run_agent/test_background_review.py` | — | Fork behavior unit tests. |
| `tests/run_agent/test_background_review_cache_parity.py` | — | Prompt-cache key parity tests. |
| `tests/run_agent/test_background_review_toolset_restriction.py` | — | Whitelist enforcement tests. |
| `tests/run_agent/test_review_prompt_class_first.py` | — | Class-first rubric prompt tests (per v0.12 #16026). |
| `tests/run_agent/test_background_review_summary.py` | — | Action-summary extraction tests. |
| `tests/hermes_cli/test_curator_status.py` | — | `hermes curator status` CLI tests. |
| `tests/tools/test_skill_provenance.py` | — | `is_agent_created` provenance tests. |

Confirmed via `wc -l agent/curator.py agent/curator_backup.py hermes_cli/curator.py tools/skill_usage.py tools/skill_manager_tool.py` (totalling **4612 LoC** across the 5 files).

## Canonical entry points

Two functions. The first is invoked after every turn that meets the trigger criteria; the second is invoked on a 7-day timer (or manually):

```python
# run_agent.py:4230
def _spawn_background_review(
    self,
    messages_snapshot: List[Dict],
    review_memory: bool = False,
    review_skills: bool = False,
) -> None:
    """Spawn a background thread to review the conversation for memory/skill saves.

    Creates a full AIAgent fork with the same model, tools, and context as the
    main session. The review prompt is appended as the next user turn in the
    forked conversation. Writes directly to the shared memory/skill stores.
    Never modifies the main conversation history or produces user-visible output.
    """
```

```python
# agent/curator.py:1369
def run_curator_review(
    on_summary: Optional[Callable[[str], None]] = None,
    synchronous: bool = False,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """Execute a single curator review pass.

    Steps:
      1. Apply automatic state transitions (pure, no LLM).
      2. If there are agent-created skills, spawn a forked AIAgent that runs
         the LLM review prompt against the current candidate list.
      3. Update .curator_state with last_run_at and a one-line summary.
      4. Invoke *on_summary* with a user-visible description.
    """
```

## Happy path: end-of-turn fork → skill written → curator weeks later → consolidation

```
[Turn 5 finishes. Kernel checks: should we fire a review?]
  └─ run_agent.py:15633 + 15808 — trigger evaluation
  └─ If review_memory or review_skills triggers fire:
     └─ self._spawn_background_review(messages_snapshot, review_memory=True, review_skills=True)
          └─ threading.Thread(target=_run_review, daemon=True).start()

[Inside _run_review thread, with stdout/stderr redirected to devnull]
  └─ Install non-interactive approval callback (_bg_review_auto_deny)
       └─ Returns "deny" for any dangerous-command guard — prevents deadlock with parent's TUI (#15216)
  └─ _parent_runtime = self._current_main_runtime()
       └─ {provider, model, base_url, api_key, api_mode}
  └─ If api_mode == "codex_app_server" → downgrade to "codex_responses"
       └─ Reason: review fork needs memory/skill tools, codex_app_server bypasses Hermes' dispatch
  └─ review_agent = AIAgent(
         model=self.model,
         max_iterations=16,
         quiet_mode=True,
         provider=self.provider,
         api_mode=_parent_api_mode,
         base_url=_parent_runtime["base_url"],
         api_key=_parent_runtime["api_key"],
         credential_pool=self._credential_pool,
         parent_session_id=self.session_id,
     )
  └─ review_agent._memory_write_origin = "background_review"
  └─ review_agent._memory_write_context = "background_review"
  └─ review_agent._cached_system_prompt = self._cached_system_prompt
       └─ KEY: inherits parent's exact byte-identical system prompt
       └─ → outbound HTTP request hits same Anthropic/OpenRouter prefix-cache
       └─ → ~26% end-to-end cost reduction on Sonnet 4.5 (per issue #25322, PR #17276)
  └─ review_agent.session_start = self.session_start
  └─ review_agent.session_id = self.session_id

  └─ review_whitelist = {tool["function"]["name"] for tool in get_tool_definitions(
                             enabled_toolsets=["memory", "skills"], quiet_mode=True)}
  └─ set_thread_tool_whitelist(review_whitelist, deny_msg_fmt=…)
       └─ Per-thread tool gating — any non-whitelisted tool call returns deny_msg at runtime

  └─ prompt = self._COMBINED_REVIEW_PROMPT  # or _MEMORY_REVIEW_PROMPT or _SKILL_REVIEW_PROMPT
       └─ Class-first rubric (per v0.12 #16026): explicit grading prompt
  └─ review_agent.run_conversation(
         user_message=prompt + "\n\nYou can only call memory and skill management tools. …",
         conversation_history=messages_snapshot,
     )
       └─ Review agent makes 1-3 tool calls: memory.add(…), skill_manage(action="patch", …)
       └─ Returns the model's final response (we don't surface it)

  └─ clear_thread_tool_whitelist()
  └─ review_agent.shutdown_memory_provider()
       └─ Flushes Honcho / Hindsight / etc. asynchronously

  └─ actions = self._summarize_background_review_actions(
         review_agent._session_messages, messages_snapshot)
       └─ Scans the fork's tool messages for "created"/"updated"/"saved" patterns
       └─ Skips tool messages already in messages_snapshot (issue #14944)

  └─ If actions: surface compact summary
       └─ "  💾 Self-improvement review: created skill `test-runner` · saved memory `tsc strict`"
       └─ self.background_review_callback(summary)  # optional gateway delivery

[Days later, agent has been used regularly, skill_usage.bump_use is called each invocation]
  └─ tools/skill_view.py and skill_manage handlers call:
     skill_usage.bump_use(name)
       └─ tools/skill_usage.py
       └─ With _usage_file_lock() (fcntl or msvcrt for cross-platform locking):
            usage = read .usage.json
            usage[name]["use_count"] += 1
            usage[name]["last_used_at"] = now_iso()
            atomic write back

[7 days after last curator run, hermes idle for 2+ hours]
  └─ maybe_run_curator() invoked from the gateway / CLI on the cron ticker
  └─ should_run_now() returns True
  └─ run_curator_review(on_summary=…, synchronous=False)
       └─ agent/curator.py:1369
       1. curator_backup.snapshot_skills(reason="pre-curator-run")
            └─ tar.gz of ~/.hermes/skills/ → ~/.hermes/skills/.archive/snapshots/
       2. apply_automatic_transitions(now)
            └─ Pure code, no LLM. Walks .usage.json:
               - active → stale: latest_activity_at older than stale_after_days (default 30)
               - stale → archived: older than archive_after_days (default 90)
               - Moves files to ~/.hermes/skills/.archive/<skill-name>/
               - Records `state` and `archived_at` in usage record
            └─ Returns {checked, marked_stale, archived, reactivated}
       3. before_report = skill_usage.agent_created_report()  # for diffing
       4. _llm_pass() — runs in daemon thread (unless synchronous):
            a. candidate_list = _render_candidate_list()  # one-line per agent-created skill
            b. prompt = CURATOR_REVIEW_PROMPT + "\n\n" + candidate_list
            c. llm_meta = _run_llm_review(prompt)
                 └─ Spawns same forked AIAgent shape as background review,
                   restricted to skill_manage toolset
                 └─ LLM reads each skill's SKILL.md content via skill_view
                 └─ LLM calls skill_manage with actions: archive, consolidate, patch, rename
            d. _write_run_report(start, elapsed, counts, before, after, llm_meta)
                 └─ ~/.hermes/skills/.curator-runs/<timestamp>/REPORT.md
                 └─ ~/.hermes/skills/.curator-runs/<timestamp>/run.json
            e. state.last_run_at = start, state.last_run_summary = "…", state.last_report_path = …
            f. on_summary(f"curator: {final_summary}")
       └─ User sees in chat: "✨ curator: auto: 3 marked stale, 1 archived; llm: consolidated test-runner → testing-toolkit"
```

## Architectural decisions

### AD-1: The fork inherits the parent's live runtime (provider, model, credentials)

- **Decision**: When the kernel spawns a background-review AIAgent, it passes the parent's `_current_main_runtime()` snapshot — provider, model, base_url, api_key, api_mode, credential_pool — so the fork uses the *exact* same creds.

- **Evidence**: `run_agent.py:4275-4305`:

  ```python
  # Inherit the parent agent's live runtime (provider, model,
  # base_url, api_key, api_mode) so the fork uses the exact
  # same credentials the main turn is using.  Without this,
  # AIAgent.__init__ re-runs auto-resolution from env vars,
  # which fails for OAuth-only providers, session-scoped
  # creds, or credential-pool setups where the resolver can't
  # reconstruct auth from scratch -- producing the spurious
  # "No LLM provider configured" warning at end of turn.
  _parent_runtime = self._current_main_runtime()
  ```

- **Rationale**: Pre-#16099 (per RELEASE_v0.12.0.md), the fork called `AIAgent.__init__()` which re-ran provider auto-detection from env vars. This worked for the common case (env vars set) but broke for OAuth flows (no static api_key), credential pools (auth.json with rotating keys), and session-scoped creds. The fix was explicit credential injection.

- **TypeScript translation**: `Agent.fork({ runtime })` API that captures the parent's resolved provider/model/credentials. Never re-run auto-detection in the fork.

### AD-2: The fork inherits the parent's cached system prompt VERBATIM

- **Decision**: The fork copies `self._cached_system_prompt` from the parent. The byte-identical prefix guarantees a prompt-cache hit on the provider side.

- **Evidence**: `run_agent.py:4322-4332`:

  ```python
  # Inherit the parent's cached system prompt verbatim so
  # the review fork's outbound HTTP request hits the same
  # Anthropic/OpenRouter prefix cache the parent warmed.
  # Without this, the fork rebuilds the system prompt from
  # scratch (fresh _hermes_now() timestamp, fresh
  # session_id, narrower toolset → different skills_prompt)
  # and the byte-exact prefix-cache key misses. See
  # issue #25322 and PR #17276 for the full analysis +
  # measured impact (~26% end-to-end cost reduction on
  # Sonnet 4.5).
  review_agent._cached_system_prompt = self._cached_system_prompt
  ```

- **Rationale**: Anthropic/OpenRouter prompt caching is byte-exact. The fork's system prompt is *almost* identical to the parent's — same skills, same tools — but `_hermes_now()` produces a fresh timestamp and `session_id` may differ, and the narrower toolset changes the `skills_prompt`. Without verbatim inheritance, the fork misses the cache and pays full prefix tokens. The 26% saving on Sonnet 4.5 makes this load-bearing.

- **TypeScript translation**: The forked Agent must reuse the parent's `Agent._cachedSystemPrompt` field exactly. **Do not** regenerate it. Tests must assert byte-equality of the system prompt between parent and fork.

### AD-3: Toolset restricted to memory + skills via per-thread whitelist

- **Decision**: Before invoking `run_conversation`, the kernel sets a per-thread tool whitelist limiting the fork to `enabled_toolsets=["memory", "skills"]`. Any other tool call is denied at runtime with a structured message.

- **Evidence**: `run_agent.py:4343-4362`:

  ```python
  from model_tools import get_tool_definitions
  from hermes_cli.plugins import (
      set_thread_tool_whitelist,
      clear_thread_tool_whitelist,
  )

  review_whitelist = {
      t["function"]["name"]
      for t in get_tool_definitions(
          enabled_toolsets=["memory", "skills"],
          quiet_mode=True,
      )
  }
  set_thread_tool_whitelist(
      review_whitelist,
      deny_msg_fmt=(
          "Background review denied non-whitelisted tool: "
          "{tool_name}. Only memory/skill tools are allowed."
      ),
  )
  ```

- **Rationale**: Per v0.12 #16569 ("Scoped toolsets — review fork restricted to memory + skills (no shell, no web)") — without this restriction, a confused review fork could invoke terminal, search, web tools and leak data or take destructive actions. Memory and skills are the only legitimate outputs of a review.

- **TypeScript translation**: `Agent.fork({ allowedToolsets: ["memory", "skills"] })`. Whitelist enforced at the tool-dispatcher level via `AsyncLocalStorage` (Node's equivalent of Python's thread-local) so concurrent forks don't bleed.

### AD-4: Dangerous-command auto-deny prevents TUI deadlock

- **Decision**: The fork installs a non-interactive approval callback that auto-denies any dangerous-command prompt. Without this, the fork's tools could trigger an interactive `input()` prompt that deadlocks against the parent's TUI.

- **Evidence**: `run_agent.py:4255-4269`:

  ```python
  # Install a non-interactive approval callback on this worker
  # thread so any dangerous-command guard the review agent trips
  # resolves to "deny" instead of falling back to input() -- which
  # deadlocks against the parent's prompt_toolkit TUI (#15216).
  # Same pattern as _subagent_auto_deny in tools/delegate_tool.py.
  def _bg_review_auto_deny(command, description, **kwargs):
      logger.warning(
          "Background review auto-denied dangerous command: %s (%s)",
          command, description,
      )
      return "deny"
  try:
      _set_approval_callback(_bg_review_auto_deny)
  except Exception:
      pass
  ```

- **Rationale**: Issue #15216 documents the actual deadlock. The parent thread owns the TTY; a worker thread calling `input()` would block forever. Auto-denying is safe (the fork shouldn't be running shell commands anyway, and is whitelisted to memory+skills only — this is belt-and-suspenders).

- **TypeScript translation**: Forked Agent gets a non-interactive `approvalHandler` set in its constructor that returns `deny` for anything dangerous. Since TypeScript doesn't have `input()`, the analog is preventing the fork from awaiting any user-facing prompt resolver.

### AD-5: Stdout/stderr redirected to devnull for the entire fork's lifetime

- **Decision**: The fork runs inside `contextlib.redirect_stdout(_devnull)` + `redirect_stderr(_devnull)`. Memory provider teardown also stays inside the redirect.

- **Evidence**: `run_agent.py:4272-4274` and the safety-net at `:4420-4429`.

  ```python
  with open(os.devnull, "w", encoding="utf-8") as _devnull, \
       contextlib.redirect_stdout(_devnull), \
       contextlib.redirect_stderr(_devnull):
      ...
  ```

- **Rationale**: The fork is invisible. Even mid-review warnings ("Iteration budget exhausted", rate-limit retries, compression warnings) must not leak past the redirect. The agent's `_emit_status` and `_vprint` go via `_print_fn`/`status_callback` which *bypass* `sys.stdout`, so a second guard (`suppress_status_output = True`) is also set at `:4321`. Both guards are required.

- **TypeScript translation**: We do not redirect Node's stdout/stderr — they are process-wide. Instead, give the forked Agent a `silent: true` option that suppresses all `console.log`/`console.warn` paths from inside the fork. We also need a `eventEmitter` mode where the fork can emit telemetry without printing.

### AD-6: Action summary scanned post-completion; skip stale tool messages

- **Decision**: After the fork completes, scan its `_session_messages` for tool messages matching success patterns (`created`, `updated`, `saved`). Skip messages that were *already* in `messages_snapshot` (the inherited conversation history) because they shipped earlier and re-surfacing them looks like the fork re-did them.

- **Evidence**: `run_agent.py:4392-4399`:

  ```python
  # Scan the review agent's messages for successful tool actions
  # and surface a compact summary to the user. Tool messages
  # already present in messages_snapshot must be skipped, since
  # the review agent inherits that history and would otherwise
  # re-surface stale "created"/"updated" messages from the prior
  # conversation as if they just happened (issue #14944).
  actions = self._summarize_background_review_actions(
      getattr(review_agent, "_session_messages", []),
      messages_snapshot,
  )
  ```

- **Rationale**: Without the snapshot-skip, every review would announce all prior tool successes as if they just happened. Issue #14944 documents the bug — users were confused by repeated "memory saved" messages.

- **TypeScript translation**: Same — pass `priorMessageCount` to the summarizer so it scans only fork-originated messages.

### AD-7: Curator default 7-day interval; runs only when idle

- **Decision**: Default curator interval is `24 * 7 = 168` hours. The curator runs only when the agent is idle (`min_idle_hours = 2`).

- **Evidence**: `agent/curator.py:56-58`:

  ```python
  DEFAULT_INTERVAL_HOURS = 24 * 7  # 7 days
  DEFAULT_MIN_IDLE_HOURS = 2
  DEFAULT_STALE_AFTER_DAYS = 30
  DEFAULT_ARCHIVE_AFTER_DAYS = 90
  ```

  And `should_run_now()` at `:199-256` (skipped reading the body but the function name + constants tell the story).

- **Rationale**: Curator is a heavy operation (LLM review pass over many skills). Running it on every session start would be obnoxious. Tying to "idle for 2 hours" means it fires while the user is away, not mid-task.

- **TypeScript translation**: `Skills.startCurator({ intervalHours: 168, minIdleHours: 2 })`. Default off; user opts in. Idle detection via Node's `process.uptime()` and a timer.

### AD-8: Pre-run snapshot to `~/.hermes/skills/.archive/snapshots/`

- **Decision**: Before any LLM mutation, the curator takes a tar.gz snapshot of the entire `~/.hermes/skills/` tree. If the LLM goes off the rails, the user can restore.

- **Evidence**: `agent/curator.py:1411-1420`:

  ```python
  # Pre-mutation snapshot — best-effort, never blocks the run. A
  # failed snapshot logs at debug and continues (the alternative is
  # that a transient disk issue silently disables curator forever,
  # which is worse). Users who want to require snapshots can disable
  # curator entirely until they can fix disk space.
  try:
      from agent import curator_backup
      snap = curator_backup.snapshot_skills(reason="pre-curator-run")
      if snap is not None and on_summary:
          try:
              on_summary(f"curator: snapshot created ({snap.name})")
          except Exception:
              pass
  except Exception as e:
      logger.debug("Curator pre-run snapshot failed: %s", e, exc_info=True)
  ```

- **Rationale**: The curator's LLM call has full skill_manage permissions. A regressed model could mis-consolidate, mis-archive, or destroy good skills. Snapshot-first means worst case is "restore from snapshot and disable curator." The fallback is intentionally non-blocking (a transient disk issue should not permanently disable curation).

- **TypeScript translation**: `Skills.snapshot()` produces a tar.gz under `.theokit/skills/.archive/snapshots/`. `Skills.restoreSnapshot(name)` reverses. Use `tar` package or `node-tar` (peer dep).

### AD-9: Two passes — auto-transitions (pure) then LLM review (forked)

- **Decision**: The curator has two phases. **Phase 1** is pure code with no LLM: walk `.usage.json`, transition active → stale (30 days idle) → archived (90 days idle). **Phase 2** is the LLM forked agent that grades, consolidates, and patches.

- **Evidence**: `agent/curator.py:1376-1381`:

  ```
  Steps:
    1. Apply automatic state transitions (pure, no LLM).
    2. If there are agent-created skills, spawn a forked AIAgent that runs
       the LLM review prompt against the current candidate list.
    3. Update .curator_state with last_run_at and a one-line summary.
    4. Invoke *on_summary* with a user-visible description.
  ```

- **Rationale**: Determinism is cheap and reliable. Stale/archive transitions don't need an LLM to make — they're based on timestamps. The LLM is reserved for the *judgment* work (which skills are duplicates? which should be patched?). Splitting the passes lets the auto-pass run even if the LLM is unavailable.

- **TypeScript translation**: `Skills.applyAutomaticTransitions()` + `Skills.runLlmReview()` as separately invokable methods. `Skills.runCurator()` calls both in order.

### AD-10: Provenance gate — only touch agent-created skills

- **Decision**: The curator only operates on skills with `created_by: "agent"` provenance. Bundled (shipped) and hub-installed skills are off-limits.

- **Evidence**: `agent/curator.py:15-19`:

  ```
  Strict invariants:
    - Only touches agent-created skills (see tools/skill_usage.is_agent_created)
    - Never auto-deletes — only archives. Archive is recoverable.
    - Pinned skills bypass all auto-transitions
    - Uses the auxiliary client; never touches the main session's prompt cache
  ```

  And `skill_usage.py:151-200` reads `.bundled_manifest` and `.hub/lock.json` to compute the off-limits set.

- **Rationale**: User-installed skills are a contract — they should not be silently archived because the user didn't use them this month. Bundled skills are an integrity concern — modifying them breaks updates. Only skills the agent itself made are fair game.

- **TypeScript translation**: `Skills.isAgentCreated(name): boolean` consults a `.bundled_manifest` and `.hub/lock.json` equivalent. The curator's LLM prompt explicitly lists *only* agent-created skills as candidates.

### AD-11: Three review prompts (memory-only, skills-only, combined)

- **Decision**: The kernel picks one of three prompts based on which triggers fired: `_MEMORY_REVIEW_PROMPT`, `_SKILL_REVIEW_PROMPT`, `_COMBINED_REVIEW_PROMPT` (all class attributes on `AIAgent`).

- **Evidence**: `run_agent.py:4245-4251`:

  ```python
  # Pick the right prompt based on which triggers fired
  if review_memory and review_skills:
      prompt = self._COMBINED_REVIEW_PROMPT
  elif review_memory:
      prompt = self._MEMORY_REVIEW_PROMPT
  else:
      prompt = self._SKILL_REVIEW_PROMPT
  ```

- **Rationale**: Different triggers want different review work. A long conversation with novel facts should review memory. A successful tool-heavy session should review skills. Both criteria firing means review both. Three distinct prompts keep each focused (per v0.12 #16026 "class-first rubric").

- **TypeScript translation**: Same three prompts as constants. Trigger logic exposed as `Memory.shouldReview()` and `Skills.shouldReview()` predicates that the kernel composes.

### AD-12: Persistent `.curator_state` file with atomic writes

- **Decision**: Curator state (last_run_at, last_run_duration, run_count, paused, last_report_path) lives in `~/.hermes/skills/.curator_state` as JSON. Writes are atomic via `tempfile.mkstemp` + `os.replace`.

- **Evidence**: `agent/curator.py:97-115`:

  ```python
  def save_state(data: Dict[str, Any]) -> None:
      path = _state_file()
      try:
          path.parent.mkdir(parents=True, exist_ok=True)
          fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".curator_state_", suffix=".tmp")
          try:
              with os.fdopen(fd, "w", encoding="utf-8") as f:
                  json.dump(data, f, indent=2, sort_keys=True, ensure_ascii=False)
                  f.flush()
                  os.fsync(f.fileno())
              os.replace(tmp, path)
          except BaseException:
              try:
                  os.unlink(tmp)
              except OSError:
                  pass
              raise
      except Exception as e:
          logger.debug("Failed to save curator state: %s", e, exc_info=True)
  ```

- **Rationale**: Atomic writes (tempfile + rename) prevent corrupted state if the process dies mid-write. `fsync` ensures durability before rename. Best-effort error handling logs but doesn't crash — state-write failure should never wedge the agent.

- **TypeScript translation**: Our `atomicWriteJson(path, data)` helper. Same pattern: temp file → fsync → rename.

## Data structures

### Persisted

**`~/.hermes/skills/.usage.json`** — sidecar telemetry. Format: JSON object keyed by skill name. Per-skill record:

```json
{
  "test-runner": {
    "use_count": 12,
    "view_count": 5,
    "patch_count": 1,
    "last_used_at": "2026-05-01T14:23:01+00:00",
    "last_viewed_at": "2026-05-03T09:11:42+00:00",
    "last_patched_at": "2026-04-15T18:05:30+00:00",
    "created_at": "2026-04-01T10:00:00+00:00",
    "state": "active",
    "pinned": false,
    "archived_at": null,
    "absorbed_into": null,
    "provenance": "agent"
  }
}
```

States (per `skill_usage.py:52-55`): `active`, `stale`, `archived`. `pinned` is an orthogonal boolean (pinned skills bypass auto-transitions).

Locking: `_usage_file_lock` context manager at `skill_usage.py:67-96` uses `fcntl.flock` on POSIX or `msvcrt.locking` on Windows. Lock file is `.usage.json.lock`. The lock serializes read-modify-write cycles across processes.

**`~/.hermes/skills/.curator_state`** — JSON object:

```json
{
  "last_run_at": "2026-05-10T03:00:00+00:00",
  "last_run_duration_seconds": 47.3,
  "last_run_summary": "auto: 3 marked stale, 1 archived; llm: consolidated test-runner → testing-toolkit",
  "last_run_summary_shown_at": "2026-05-10T09:15:00+00:00",
  "last_report_path": "/home/x/.hermes/skills/.curator-runs/2026-05-10T03_00_00/REPORT.md",
  "paused": false,
  "run_count": 14
}
```

**`~/.hermes/skills/.curator-runs/<iso-ts>/`** — per-run report directory:
- `REPORT.md` — human-readable summary with diff
- `run.json` — structured: started_at, elapsed_seconds, auto_counts, before/after skill list, llm tool_calls, errors

**`~/.hermes/skills/.archive/`** — archived skills. Each archived skill becomes a subdirectory here. Restorable via `hermes curator restore <name>`.

**`~/.hermes/skills/.archive/snapshots/`** — pre-run tar.gz snapshots (from `curator_backup.snapshot_skills`).

**`~/.hermes/skills/.bundled_manifest`** — text file: `name:hash` per line. Identifies bundled (shipped) skills the curator must not touch.

**`~/.hermes/skills/.hub/lock.json`** — hub-installed skills lockfile. Same off-limits semantics.

### In-memory

Defined in `agent/curator.py` and `tools/skill_usage.py`:

```python
# agent/curator.py:47-53
class _ReviewRuntimeBinding(NamedTuple):
    provider: str
    model: str
    explicit_api_key: Optional[str]
    explicit_base_url: Optional[str]

# Curator state (dict, not dataclass; tolerant of legacy keys)
{
  "last_run_at": Optional[str],         # ISO timestamp
  "last_run_duration_seconds": Optional[float],
  "last_run_summary": Optional[str],
  "last_run_summary_shown_at": Optional[str],
  "last_report_path": Optional[str],
  "paused": bool,
  "run_count": int,
}

# skill_usage record (dict)
{
  "use_count": int,
  "view_count": int,
  "patch_count": int,
  "last_used_at": Optional[str],
  "last_viewed_at": Optional[str],
  "last_patched_at": Optional[str],
  "created_at": Optional[str],
  "state": Literal["active", "stale", "archived"],
  "pinned": bool,
  "archived_at": Optional[str],
  "absorbed_into": Optional[str],       # set when consolidated into umbrella
  "provenance": Optional[Literal["agent", "user", "bundled", "hub"]],
}
```

### Concurrency model

- **Background review fork**: spawns a daemon thread (`threading.Thread(target=_run_review, daemon=True)`). One per turn at most. Per-thread tool whitelist via `AsyncLocalStorage`-equivalent (`set_thread_tool_whitelist`).
- **Curator review**: spawns a daemon thread for the LLM pass when `synchronous=False`. Auto-transitions run inline.
- **`.usage.json` writes**: cross-process file lock via fcntl/msvcrt.
- **`.curator_state` writes**: atomic temp-file + rename. No explicit lock (state is single-writer).

## Failure modes Hermes already fixed

### 1. Fork re-runs provider auto-detection from env vars (broken for OAuth)

- **What can go wrong**: Pre-#16099, fork called `AIAgent.__init__()` with default provider/model. Auto-detection failed for OAuth-only providers (no static api_key in env), credential pools, session-scoped creds.
- **How Hermes handles it**: Inherit `_current_main_runtime()` from parent. `run_agent.py:4275-4305`.
- **Evidence**: RELEASE_v0.12.0.md PR #16099 "Fork inherits parent's live runtime — provider, model, credentials actually propagate now".

### 2. Prompt cache miss when fork rebuilds system prompt

- **What can go wrong**: Fork's system prompt has fresh `_hermes_now()` timestamp and different `skills_prompt` (narrower toolset). Byte-exact prefix cache misses → 26% cost increase.
- **How Hermes handles it**: Verbatim copy of `_cached_system_prompt`. `run_agent.py:4322-4332`.
- **Evidence**: Issue #25322, PR #17276.

### 3. Fork's `input()` deadlocks against parent's TUI (#15216)

- **What can go wrong**: Fork tries to prompt for dangerous-command approval. `input()` blocks the worker thread while the parent thread owns the TTY. Both threads frozen.
- **How Hermes handles it**: Install non-interactive `_bg_review_auto_deny` approval callback. `run_agent.py:4255-4269`.

### 4. Mid-review status leaks past stdout redirect (#issue numbered above)

- **What can go wrong**: `_emit_status`/`_vprint` go via `_print_fn`/`status_callback`, which bypass `sys.stdout`. Redirect doesn't catch them.
- **How Hermes handles it**: Set `review_agent.suppress_status_output = True`. Two guards required (redirect + flag). `run_agent.py:4314-4321`.

### 5. Stale tool messages from inherited history re-surface as new actions (#14944)

- **What can go wrong**: Fork inherits `messages_snapshot` containing prior tool successes. Naïve scan reports them as fresh review actions.
- **How Hermes handles it**: `_summarize_background_review_actions` skips messages present in the snapshot. `run_agent.py:4396-4399`.

### 6. Curator consolidates skills incorrectly, user loses good skills

- **What can go wrong**: LLM mis-judges duplicates and consolidates a unique skill into an umbrella.
- **How Hermes handles it**: Pre-run snapshot (`agent/curator.py:1411-1420`). Archive (never delete). Pinned skills exempt. Plus diff stored in REPORT.md so user can see what changed.

### 7. Substring matching false positives in consolidation (#19573)

- **What can go wrong**: Per RELEASE_v0.13.0.md PR #19573 — "Fix: prevent false-positive consolidation from substring matching". The classifier compared substrings of skill names and incorrectly grouped unrelated skills.
- **How Hermes handles it**: Tighter classifier logic (in `_classify_removed_skills` at `agent/curator.py:492`, not deep-read here but the fix is acknowledged).

### 8. Background-review sediment marks user skills as agent-created (#19621)

- **What can go wrong**: PR #19621 — "Fix: only mark agent-created for background-review sediment". The fork was setting `created_by: "agent"` on skills the *user* had authored, making them eligible for curator pruning.
- **How Hermes handles it**: Only background-review-originated writes set the agent provenance. User-direct writes via `skill_manage` from the main session do not.

### 9. Curator restores skills from nested archive subdirs incorrectly (#17951)

- **What can go wrong**: Archived skills with subdirectories (templates, scripts) lost the nesting on restore.
- **How Hermes handles it**: PR #17951 by @0xDevNinja — recursive scan in `restore_skill`. Not deep-read but the fix landed in v0.12.

### 10. Skill pinned but curator still wrote (#17562)

- **What can go wrong**: Pinned skills should be totally exempt from auto-mutations. Earlier code only blocked archival but allowed patch.
- **How Hermes handles it**: PR #17562 + #17578 — `skill_manage` refuses writes on pinned skills entirely. Documented at AGENTS.md:748-752.

### 11. Bundled/hub skill provenance leak

- **What can go wrong**: A skill named the same as a hub-installed one could be mis-classified as agent-created and pruned.
- **How Hermes handles it**: PR #20194 — "protect hub skills by frontmatter name" (per RELEASE_v0.13.0.md:321). Provenance matched by SKILL.md frontmatter, not directory name.

### 12. Atomic write on `.usage.json` fails silently

- **What can go wrong**: Disk full mid-write corrupts the file.
- **How Hermes handles it**: Atomic `tempfile.mkstemp` + `os.replace` pattern in `skill_usage.py` (mirroring `curator.py:97-115`). File lock prevents partial reads.

## TypeScript API proposal

### Public surface

```typescript
// src/index.ts
export { Memory } from "./memory";
export { Skills } from "./skills";

// src/memory/types.ts
export interface MemoryProposeOptions {
  /** Bypass the kernel trigger and force a review now. */
  force?: boolean;
  /** Restrict the review to memory-only or skills-only. */
  scope?: "memory" | "skills" | "combined";
}

// Memory namespace
declare module "./memory" {
  interface Memory {
    /**
     * Kernel-internal: spawn a background review fork.
     * Forks the parent Agent with credentials + cached system prompt,
     * restricted to memory + skills toolsets.
     *
     * Returns the review handle; if `wait: true` resolves when complete.
     * Otherwise fire-and-forget.
     */
    spawnBackgroundReview(opts: {
      messagesSnapshot: ReadonlyArray<ChatMessage>;
      reviewMemory?: boolean;
      reviewSkills?: boolean;
      wait?: boolean;
      onSummary?: (summary: string) => void;
    }): Promise<BackgroundReviewResult>;

    /**
     * User-facing: force a proposeSkill review of recent turns.
     * For programmatic use; the autonomous path is triggered by Agent.
     */
    proposeSkill(opts: { sessionId: string; turnsBack?: number }): Promise<SkillProposal>;
  }
}

// src/skills/index.ts — the Curator surface
export class Skills {
  // Singleton accessed via theokit() handle or static factory
  static getInstance(): Skills;

  // ---- Auto-transitions (pure) ------------------------------------------
  async applyAutomaticTransitions(opts?: {
    now?: Date;
    staleAfterDays?: number;       // default 30
    archiveAfterDays?: number;     // default 90
  }): Promise<{ checked: number; markedStale: number; archived: number; reactivated: number }>;

  // ---- LLM review pass --------------------------------------------------
  async runCurator(opts?: {
    synchronous?: boolean;
    dryRun?: boolean;
    onSummary?: (summary: string) => void;
    runtime?: {
      provider?: string;
      model?: string;
    };
  }): Promise<CuratorRunResult>;

  // ---- Scheduling -------------------------------------------------------
  startCurator(opts?: {
    intervalHours?: number;        // default 168 (7 days)
    minIdleHours?: number;         // default 2
  }): { stop: () => void };

  // ---- State management -------------------------------------------------
  getCuratorState(): Promise<CuratorState>;
  pauseCurator(): Promise<void>;
  resumeCurator(): Promise<void>;

  // ---- Skill operations -------------------------------------------------
  list(filter?: { state?: "active" | "stale" | "archived"; pinned?: boolean }): Promise<SkillRecord[]>;
  archive(name: string): Promise<void>;
  restore(name: string): Promise<void>;
  pin(name: string): Promise<void>;
  unpin(name: string): Promise<void>;
  prune(opts?: { dryRun?: boolean }): Promise<{ archived: string[] }>;
  snapshot(reason?: string): Promise<{ path: string; sizeBytes: number }>;
  restoreSnapshot(snapshotName: string): Promise<void>;
  bumpUse(name: string): Promise<void>;     // For SDK integrations to record usage

  // ---- Provenance -------------------------------------------------------
  isAgentCreated(name: string): Promise<boolean>;
}
```

### Internal module layout

```
packages/sdk/src/internal/skills/
├── usage.ts              # .usage.json sidecar — bumpUse, bumpView, bumpPatch
├── usage-lock.ts         # fcntl/msvcrt-like cross-process lock (use proper-lockfile)
├── provenance.ts         # isAgentCreated, _read_bundled_manifest_names, _read_hub_installed_names
├── curator/
│   ├── state.ts          # .curator_state load/save (atomic)
│   ├── transitions.ts    # applyAutomaticTransitions (pure)
│   ├── orchestrator.ts   # runCurator entry — backup + transitions + LLM pass
│   ├── llm-review.ts     # _run_llm_review — spawns forked Agent
│   ├── prompts.ts        # CURATOR_REVIEW_PROMPT + DRY_RUN_BANNER constants
│   ├── classify.ts       # _classify_removed_skills (consolidated vs pruned)
│   ├── reports.ts        # _write_run_report + _render_report_markdown
│   ├── rename-summary.ts # _build_rename_summary for "old → umbrella" lines
│   └── backup.ts         # snapshotSkills via tar
├── archive.ts            # archive/restore/prune
└── manager.ts            # skill_manage tool implementation

packages/sdk/src/internal/agent/
├── background-review.ts  # _spawn_background_review equivalent
└── review-prompts.ts     # MEMORY_REVIEW, SKILL_REVIEW, COMBINED_REVIEW
```

### Persistence layout

```
~/.theokit/skills/
├── .usage.json                       # Per-skill telemetry (jsonl-style or single JSON object)
├── .usage.json.lock                  # File lock for usage.json read-modify-write
├── .bundled_manifest                 # "name:hash" per line — off-limits skills
├── .hub/
│   └── lock.json                     # Hub-installed skills
├── .curator_state                    # Last run timestamp, summary, etc.
├── .archive/
│   ├── snapshots/                    # Pre-run tar.gz backups
│   │   └── 2026-05-10T03_00_00.tar.gz
│   └── <skill-name>/                 # Archived skills (restorable)
├── .curator-runs/
│   └── 2026-05-10T03_00_00/
│       ├── REPORT.md
│       └── run.json
└── <skill-name>/
    ├── SKILL.md
    ├── scripts/
    ├── references/
    └── templates/
```

Matches Hermes' layout 1:1 with `.theokit` prefix.

### Optional peer dependencies

| Dep | Why | When required |
|---|---|---|
| `proper-lockfile` | Cross-process file lock for `.usage.json` | Always when Curator/skill_usage is active |
| `tar` or `node-tar` | snapshot/restore .tar.gz of skills tree | Only if user calls `Skills.snapshot()` or curator |
| Existing OpenAI/Anthropic SDK | LLM call for curator review | Already a peer dep of the SDK |

### Migration impact on v1.2 users

- **Backward-compatible**: Yes. `Memory.spawnBackgroundReview` is new (kernel-internal); `Memory.proposeSkill` is new (user-facing). `Skills` is a new namespace.
- **Breaking signature changes**: None.
- **Migration path**: Curator is opt-in. Background review is opt-in via `Agent.create({ autoReview: { memory: true, skills: true } })`.

## Test strategy

Hermes test files to port:

- `tests/run_agent/test_background_review.py` — fork basics, runtime inheritance, whitelist enforcement
- `tests/run_agent/test_background_review_cache_parity.py` — byte-equality of system prompt between parent and fork
- `tests/run_agent/test_background_review_toolset_restriction.py` — denies non-whitelisted tool calls
- `tests/run_agent/test_review_prompt_class_first.py` — rubric prompt structure
- `tests/run_agent/test_background_review_summary.py` — action extraction skipping prior messages
- `tests/hermes_cli/test_curator_status.py` — CLI surface
- `tests/tools/test_skill_provenance.py` — bundled/hub/agent provenance

**Unit tests**:
- `applyAutomaticTransitions`: tasks with `last_used_at` older/newer than thresholds transition correctly. Pinned skips. Reactivation on use.
- `_classify_removed_skills`: substring false-positive regression (PR #19573 fix).
- `isAgentCreated`: each of bundled/hub/agent/user → correct boolean.
- Atomic write on `.curator_state` and `.usage.json` — temp file cleaned up on failure.
- File lock contention: two concurrent `bumpUse` calls serialize correctly.

**Integration tests**:
- Spawn a real fork against a fake LLM that calls `skill_manage(action="create", name="foo", body="...")`. Assert the skill file appears in `~/.theokit/skills/foo/SKILL.md`.
- Spawn a fork that attempts a non-whitelisted tool (e.g. `terminal`). Assert the deny message is returned to the model.
- Run curator with dry_run=true; assert no mutations, REPORT.md written.

**Real-LLM tests**:
- Full end-to-end: conversation with an agent, fire `spawnBackgroundReview`, assert the real LLM creates a sensible memory/skill entry.
- Curator: populate a fake skills directory with 5 stale skills, run curator, assert LLM consolidates appropriately.

**Examples to ship**:
- `examples/autonomous-skills-quickstart/` — minimal: conversation triggers fork, fork creates a skill, user inspects it.
- `examples/curator-weekly-run/` — long-running script that periodically curates.
- `examples/curator-dry-run/` — show the report-without-mutating UX.

## Open questions

- **`_summarize_background_review_actions`**: I did not read the implementation. What success patterns does it match? Regex on tool messages? I should grep this before locking the API.
- **`_run_llm_review` in `agent/curator.py`**: I did not read this function. It is the inner call that spawns the forked AIAgent for the curator review. Behaviorally analogous to `_spawn_background_review` but different prompt and slightly different toolset (skill_manage only, not memory). Need to confirm.
- **`absorbed_into`**: When the curator consolidates skill A into umbrella B, where does the `absorbed_into: "B"` link live? In `.usage.json` per-skill record? In a separate manifest? Need to verify.
- **Rate-limit on background review firing**: a user could send 20 messages in a minute. We don't want to fire 20 review forks. Hermes uses a per-session interval — I didn't dig out the exact value. Need to find before locking the SDK trigger.
- **Codex app server downgrade**: `_parent_api_mode == "codex_app_server"` → downgraded to `"codex_responses"`. We don't have Codex/ChatGPT auth in our SDK. Do we need any analogous downgrade for OAuth-routed providers?
- **`absorbed_into` cron skill rewrites**: PR #18253 "rewrite cron job skill refs after consolidation" — if the curator absorbs skill A → B, any cron job referencing A by name has to be updated. This is a side effect we need to mirror.

## References

- `referencia/hermes-agent/agent/curator.py:1-1781`
- `referencia/hermes-agent/run_agent.py:4168-4500` (background review)
- `referencia/hermes-agent/tools/skill_usage.py:1-609`
- `referencia/hermes-agent/tools/skill_manager_tool.py:1-931`
- `referencia/hermes-agent/agent/curator_backup.py:1-693`
- `referencia/hermes-agent/hermes_cli/curator.py:1-598`
- RELEASE_v0.12.0.md (`@autonomous-curator-self-improvement-loop`) — feature announcement
- RELEASE_v0.13.0.md (`@curator-grows-subcommands`) — synchronous run, archive/prune/list-archived
- `AGENTS.md:728-758` — Curator architecture summary
- Issues / PRs:
  - #15216 — input() deadlock with TUI
  - #25322 + PR #17276 — prompt cache parity (26% saving)
  - #14944 — stale tool messages re-surfaced
  - PR #16099 — fork inherits parent runtime
  - PR #16569 — scoped toolsets (memory + skills only)
  - PR #19573 — substring consolidation false positive
  - PR #19621 — agent-created provenance only for review-sourced writes
  - PR #20194 — protect hub skills by frontmatter name
  - PR #17562 + #17578 — `skill_manage` refuses pinned skills
- Theokit ADRs:
  - D9 — Memory namespace defaults — feeds into the kernel trigger thresholds
  - D11 — Embedding adapters — Curator's review fork uses the same auxiliary client
  - D14 — Dreaming narrative LLM deferred — *this* is the new dreaming-equivalent
