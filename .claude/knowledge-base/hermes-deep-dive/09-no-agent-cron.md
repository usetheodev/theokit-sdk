# 09 — `no_agent` Cron Mode (script-only watchdog)

> Hermes cron jobs default to LLM-driven execution: the schedule fires, the
> agent receives a prompt (possibly augmented with a pre-run script's
> stdout), the agent reasons + acts + reports. The v0.13 PR #19709 added
> `no_agent: True` mode: skip the agent entirely. Run a script on schedule,
> deliver its stdout verbatim, treat empty stdout as silent. Built on top
> of v0.11 PR #12373's `wakeAgent` gate (the script could already short-
> circuit the agent by emitting `{"wakeAgent": false}`); `no_agent` makes
> that the whole job. Classic bash-watchdog pattern with zero LLM cost. In
> TypeScript: `Cron.create({ noAgent: true, script, schedule, deliver })`.

## What problem this domain solves

Many cron use cases don't need an LLM:

- "Every hour, check if /var/log/app.log has new ERROR lines, post to Telegram if yes."
- "Daily at 6 AM, rsync the backup partition, alert if exit code non-zero."
- "Every 5 minutes, curl the health endpoint, page if response time > 3s."

These are classic shell-script watchdogs. Wrapping them in an LLM "decide what to report" pass adds latency, token cost, and reasoning errors. The `no_agent` mode makes cron a pure scheduler: shell out, capture stdout, deliver verbatim.

The constraint: **`no_agent` jobs must remain in the same cron infrastructure**. Same scheduling syntax, same delivery (Telegram / Discord / Slack / local), same retry budgets, same logging. Only the *body* changes from "prompt the agent" to "exec the script."

The clever bit: **empty stdout = silent**. If the script has nothing to report this tick, no message is sent. That matches the user's mental model: "alert me only when there's something to alert about."

## Hermes file layout

| File | LoC | Role |
|---|---|---|
| `cron/jobs.py` | 1114 | Job store (atomic JSON), CRUD, validation, `create_job`. |
| `cron/scheduler.py` | 1820 | Tick loop, `_run_job_script`, `_run_single_job`, delivery dispatch. |
| `cron/__init__.py` | 42 | Package init, public re-exports. |
| `tools/cronjob_tool.py` | — | Agent-facing cron management tool (referenced via AGENTS.md:763). |

`wc -l cron/*.py`: 2976 LoC across 3 files.

## Canonical entry point

```python
# cron/jobs.py:485-499
def create_job(
    prompt: Optional[str],
    schedule: str,
    *,
    name: Optional[str] = None,
    repeat: Optional[int] = None,
    deliver: Optional[str] = None,
    origin: Optional[Dict[str, Any]] = None,
    skill: Optional[str] = None,
    skills: Optional[List[str]] = None,
    model: Optional[str] = None,
    provider: Optional[str] = None,
    base_url: Optional[str] = None,
    script: Optional[str] = None,
    context_from: Optional[Union[str, List[str]]] = None,
    enabled_toolsets: Optional[List[str]] = None,
    workdir: Optional[str] = None,
    no_agent: bool = False,
) -> Dict[str, Any]:
    """Create a new cron job."""
```

The `no_agent` parameter switches the entire execution model.

## Happy path: schedule a no_agent watchdog, scheduler runs it

```
[User: hermes cron add "" --schedule "every 5m" --script log-watchdog.sh --no-agent --deliver telegram]
  └─ cron.jobs.create_job(
         prompt=None,
         schedule="every 5m",
         script="log-watchdog.sh",
         no_agent=True,
         deliver="telegram",
     )
       └─ cron/jobs.py:485
       └─ Validation: no_agent=True AND no script → raise ValueError(:581-585)
       └─ This passes: script is set.
       └─ job_id = uuid.uuid4().hex[:12]
       └─ job = {
              "id": job_id,
              "name": "log-watchdog.sh",  # derived from script when no prompt
              "prompt": None,
              "script": "log-watchdog.sh",
              "no_agent": True,
              "schedule": parse_schedule("every 5m"),
              "deliver": "telegram",
              "state": "scheduled",
              "next_run_at": now + 300,
              ...
          }
       └─ Atomic write to ~/.hermes/cron/jobs.json (PR #146 — atomic writes)

[Scheduler tick — every 60s by default]
  └─ cron/scheduler.py: get_due_jobs(now)
       └─ Returns jobs whose next_run_at <= now AND state == "scheduled"
       └─ get_due_jobs serialized via PR #19874 fix (parallel state corruption)

  └─ For each due job: _run_single_job(job)
       └─ cron/scheduler.py:_run_single_job

[Inside _run_single_job for no_agent job]
  └─ Line 1041: if job.get("no_agent"):
       └─ Short-circuits BEFORE importing run_agent or constructing SessionDB
          (line 1029-1031: keep this block self-contained, don't pay for agent machinery)

  └─ script_path = job["script"]  → "log-watchdog.sh"

  └─ Apply workdir if set:
       └─ _prior_cwd = os.getcwd()
       └─ os.chdir(job["workdir"])

  └─ ok, output = _run_job_script("log-watchdog.sh")
       └─ Resolves under ~/.hermes/scripts/log-watchdog.sh
       └─ Spawn: bash log-watchdog.sh (per cron/jobs.py:520-522)
       └─ Captures stdout, returncode, applies timeout
       └─ Returns (True, "ERROR found in /var/log/app.log at 14:23 …") or (False, error_text)

  └─ os.chdir(_prior_cwd)  # restore

  └─ Check exit code:
       └─ if not ok: deliver as alert "⚠ Cron watchdog 'log-watchdog.sh' script failed"
       └─ if not _parse_wake_gate(output): silent (wakeAgent=false short-circuit)
       └─ if not output.strip(): silent (empty stdout)
       └─ otherwise: deliver verbatim

  └─ Returns (success_bool, full_doc, final_response, error_message)
  └─ Scheduler dispatches to delivery target:
       └─ Telegram adapter sends final_response to the user's bot chat
       └─ Same delivery machinery as agent-driven jobs

[Watchdog has nothing to report? Empty stdout?]
  └─ Returns (True, silent_doc, SILENT_MARKER, None)
  └─ Delivery layer recognizes SILENT_MARKER and skips the send.
  └─ No Telegram message. Quiet success.

[Five minutes later, next tick fires. Repeat.]
```

## Architectural decisions

### AD-1: no_agent requires a script — validated at create time

- **Decision**: A `no_agent=True` job without a `script` is meaningless ("there is nothing to run"). The create-job validation raises `ValueError` immediately.

- **Evidence**: `cron/jobs.py:578-585`:

  ```python
  # no_agent jobs are meaningless without a script — the script IS the job.
  # Surface this as a clear ValueError at create time so bad configs never
  # reach the scheduler.
  if normalized_no_agent and not normalized_script:
      raise ValueError(
          "no_agent=True requires a script — with no agent and no script "
          "there is nothing for the job to run."
      )
  ```

- **Rationale**: Fail-fast at config time, not at the first tick fire. The user gets a clear error message they can fix immediately.

- **TypeScript translation**: Validation in `Cron.create({ noAgent: true, script })`. Throws `CronConfigError`.

### AD-2: Short-circuit BEFORE importing run_agent

- **Decision**: The no_agent branch in `_run_single_job` runs *before* importing `run_agent`, constructing `SessionDB`, or building any prompt. Self-contained block at lines 1023-1124.

- **Evidence**: `cron/scheduler.py:1029-1032`:

  ```python
  # We check this BEFORE importing run_agent / constructing SessionDB so
  # a pure-script tick never pays for the agent machinery it isn't going
  # to use. Keep this block self-contained.
  ```

- **Rationale**: Cost. The agent machinery has nontrivial cold-start cost (300-500ms of imports, schema validation, plugin discovery). A pure-script tick should be as cheap as `subprocess.run`. Skipping imports keeps it that way.

- **TypeScript translation**: In Node, lazy `import()` of the agent module only when needed. Pure-script path stays under 50ms.

### AD-3: Empty stdout = silent (no delivery)

- **Decision**: If the script's trimmed stdout is empty, return `SILENT_MARKER` and skip delivery.

- **Evidence**: `cron/scheduler.py:1105-1114`:

  ```python
  if not output.strip():
      logger.info("Job '%s' (no_agent): empty stdout — silent run", job_id)
      silent_doc = (
          f"# Cron Job: {job_name}\n\n"
          ...
          f"**Status:** silent (empty output)\n"
      )
      return True, silent_doc, SILENT_MARKER, None
  ```

- **Rationale**: The watchdog idiom: "alert me only when there's something to alert about." If nothing is wrong, no message. Users would otherwise get spam every 5 minutes with `"OK"` messages they don't read.

- **TypeScript translation**: Same `SILENT_MARKER` sentinel. Delivery layer checks for it and skips. Or: return a structured `{ delivered: boolean }` from the run.

### AD-4: Non-zero exit code = error alert (never silent)

- **Decision**: If the script exits non-zero or times out, the failure is delivered verbatim. NOT silent.

- **Evidence**: `cron/scheduler.py:1071-1088`:

  ```python
  if not ok:
      # Script crashed / timed out / exited non-zero.  Deliver the
      # error so the user knows the watchdog itself broke — silent
      # failure for an alerting job is the worst-case outcome.
      alert = (
          f"⚠ Cron watchdog '{job_name}' script failed\n\n"
          f"{output}\n\n"
          f"Time: {now_iso}"
      )
      …
      return False, doc, alert, output
  ```

- **Rationale**: A silent failure for an alerting job is the worst-case outcome. The watchdog itself broke — the user MUST know. Better to deliver a noisy error than to silently miss future alerts.

- **TypeScript translation**: Same semantics. Failures always deliver.

### AD-5: `wakeAgent: false` JSON gate = silent

- **Decision**: Pre-existing wakeAgent gate (`{"wakeAgent": false}` in script stdout) treats the tick as silent.

- **Evidence**: `cron/scheduler.py:815-835`:

  ```python
  JSON like ``{"wakeAgent": false}``, the agent is skipped entirely — no
  ...
  return gate.get("wakeAgent", True) is not False
  ```

  And no_agent integration at `:1090-1103`:

  ```python
  # Honour the wakeAgent gate as a silent signal — `wakeAgent: false`
  # means "nothing to report this tick", same as empty stdout.
  if not _parse_wake_gate(output):
      ...
      return True, silent_doc, SILENT_MARKER, None
  ```

- **Rationale**: Backward compat with v0.11's `wakeAgent` gate. A script that already used this idiom (to suppress the agent path) keeps working with `no_agent=True` — same outcome: no delivery.

- **TypeScript translation**: Same `wakeAgent` JSON parsing for output.

### AD-6: workdir applied as subprocess cwd

- **Decision**: When a job has `workdir`, no_agent jobs use it as the script's cwd. Not as TERMINAL_CWD (there's no terminal tool in this path).

- **Evidence**: `cron/jobs.py:536-538`:

  ```
  With ``no_agent=True``, ``workdir`` is still applied as the
  script's cwd so relative paths inside the script behave
  predictably.
  ```

  And the implementation at `cron/scheduler.py:1051-1066`.

- **Rationale**: A script that reads `./config.toml` needs to run from the right directory. workdir provides that.

- **TypeScript translation**: `spawn(scriptPath, [], { cwd: workdir })`. Or `process.chdir(workdir)` + restore in a try/finally (matching Python's pattern).

### AD-7: Script paths resolve under `~/.hermes/scripts/`

- **Decision**: A script name like `"log-watchdog.sh"` resolves to `~/.hermes/scripts/log-watchdog.sh`. Absolute paths are honored as-is.

- **Evidence**: `cron/jobs.py:520-522`:

  ```
  Paths resolve under ~/.hermes/scripts/; ``.sh`` / ``.bash`` files run via bash,
  anything else via Python.
  ```

- **Rationale**: Convention over configuration. Users put their watchdog scripts in a known directory; cron just references them by name. Cleaner than absolute paths in every job.

- **TypeScript translation**: `~/.theokit/scripts/`. Same resolution.

### AD-8: `.sh`/`.bash` extensions execute via bash; everything else via Python

- **Decision**: Extension-driven interpreter selection. `.sh` and `.bash` use `bash`; anything else uses `python`.

- **Evidence**: `cron/jobs.py:521-522`.

- **Rationale**: The two common watchdog interpreters. Avoids needing a shebang line in every script. Easier docs for non-developer users.

- **TypeScript translation**: Same dichotomy. We also allow `.js`/`.ts` to run via `node` (with `tsx` for TS) — natural fit for TheoKit's Node-centric audience.

### AD-9: Honors per-job `enabled_toolsets` ignored when no_agent=True

- **Decision**: `enabled_toolsets` (the per-job toolset restriction from v0.11 #14767) is *ignored* when `no_agent=True`.

- **Evidence**: `cron/jobs.py:529` ("Ignored when ``no_agent=True``.").

- **Rationale**: There's no agent. There are no toolsets to enable. The field is meaningless in this mode. Could raise an error but it's friendlier to ignore (lets users template a job config without fearing edge cases).

- **TypeScript translation**: Same — ignored when noAgent. TS type system could enforce it via discriminated union (`type CronOptions = NoAgentCron | AgentCron`).

### AD-10: Same delivery infrastructure as agent-driven jobs

- **Decision**: After the script runs, the delivery dispatch is identical to agent-driven jobs — telegram/discord/slack/local/etc. all work the same way.

- **Evidence**: `cron/scheduler.py:1124` returns `(True, doc, output, None)` in the same tuple shape as agent jobs. The caller doesn't branch.

- **Rationale**: Avoiding parallel infrastructure. One delivery path for everything.

- **TypeScript translation**: Same. Identical `CronExecutionResult` shape regardless of `noAgent`.

### AD-11: 3-minute hard interrupt still applies

- **Decision**: The 3-minute hard interrupt on cron sessions (per AGENTS.md:783-784) applies to no_agent scripts too. A script that hangs gets killed.

- **Evidence**: `_run_job_script` returns within the timeout window.

- **Rationale**: Runaway watchdogs are still bad. A script with an infinite loop would jam the scheduler forever.

- **TypeScript translation**: Pass `AbortSignal` with 3-minute timeout to the subprocess.

### AD-12: Pre-run script for agent path; no_agent IS the script

- **Decision**: With `no_agent=False`, a `script` is a *pre-run data collection step* — its stdout is injected into the agent's prompt. With `no_agent=True`, the script IS the job — its stdout is delivered verbatim.

- **Evidence**: `cron/jobs.py:516-519`:

  ```
  script: Optional path to a script whose stdout feeds the job. With
          ``no_agent=True`` the script IS the job — its stdout is
          delivered verbatim. Without ``no_agent``, its stdout is
          injected into the agent's prompt as context (data-collection /
          change-detection pattern).
  ```

- **Rationale**: Two patterns, both useful. (a) Agent + script: "here's the data, write me a report"; (b) Script-only: "here's the alert, just send it." Same script field, different semantics based on the boolean.

- **TypeScript translation**: Same dichotomy. Document clearly in `Cron.create`.

## Data structures

### Persisted

**Path**: `~/.hermes/cron/jobs.json` (atomic writes per v0.2 PR #146).

**Format**: JSON object: `{"jobs": [<job>, <job>, …]}`.

**Job shape** (excerpted from `cron/jobs.py:597-625`):

```json
{
  "id": "<12 hex>",
  "name": "log-watchdog.sh",
  "prompt": null,
  "skills": [],
  "skill": null,
  "model": null,
  "provider": null,
  "base_url": null,
  "script": "log-watchdog.sh",
  "no_agent": true,
  "context_from": null,
  "schedule": { "kind": "every", "seconds": 300, "display": "every 5m" },
  "schedule_display": "every 5m",
  "repeat": { "times": null, "completed": 0 },
  "enabled": true,
  "state": "scheduled",
  "paused_at": null,
  "paused_reason": null,
  "created_at": "2026-05-07T10:00:00+00:00",
  "next_run_at": "2026-05-07T10:05:00+00:00",
  "last_run_at": null,
  "deliver": "telegram",
  "origin": { … },
  "workdir": null,
  "enabled_toolsets": null
}
```

**Lifecycle**:
- Created via `create_job` (atomic write).
- Scheduler tick reads `jobs.json`, updates `next_run_at` and `last_run_at` (atomic write).
- File lock at `~/.hermes/cron/.tick.lock` prevents duplicate ticks (per AGENTS.md:786-788).

### In-memory

In the scheduler thread:

- `job` dicts loaded from `jobs.json` for the current tick.
- No long-lived per-job state — each tick is a discrete execution.

### Concurrency model

- **One scheduler thread** in the gateway/CLI process.
- **File lock** at `~/.hermes/cron/.tick.lock` prevents duplicate ticks across processes.
- **Serialized writes** to `jobs.json` (atomic + lock) — fixed in v0.13 PR #19874.

## Failure modes Hermes already fixed

1. **Race condition: `get_due_jobs` reads `jobs.json` twice** — v0.4 PR #1716 fixed.
2. **`repeat <= 0` from LLM passing -1 deletes the job after first run** — v0.4 PR #2612 by @Mibayy. Normalizes to None.
3. **Naive ISO timestamps fire at wrong time across timezones** — v0.4 PR #1729 fixed.
4. **Cron outputs injected into gateway session history confused alternation** — v0.4 PR #2313 fixed.
5. **Cron auto-restart loops on gateway crash** — v0.5 PR #3396 fixed.
6. **Cron session marked as ended after job completes** — v0.5 PR #2998 fixed.
7. **`[SILENT]` agents could prefix to suppress delivery** — v0.6 PR #3901 tightened.
8. **`get_due_jobs` parallel write corruption** — v0.13 PR #19874 fixed.
9. **MCP servers not initialized before cron AIAgent** — v0.13 PR #21354 fixed.
10. **Prompt-injection scan missed assembled skill content** — v0.13 PR #21350 fixed.
11. **Skill usage not bumped when cron loads skills** — v0.13 PR #19433 fixed.
12. **`next_run_at` null jobs not recovered** — v0.13 PR #19576 fixed.

## TypeScript API proposal

### Public surface

```typescript
// src/index.ts
export class Cron {
  static async create(options: CronOptions): Promise<CronJob>;
  static async list(): Promise<CronJob[]>;
  static async get(id: string): Promise<CronJob | null>;
  static async update(id: string, patch: Partial<CronOptions>): Promise<CronJob>;
  static async delete(id: string): Promise<boolean>;
  static async pause(id: string, reason?: string): Promise<boolean>;
  static async resume(id: string): Promise<boolean>;
  static async runOnce(id: string): Promise<CronExecutionResult>;
}

export type CronOptions = AgentCronOptions | NoAgentCronOptions;

export interface BaseCronOptions {
  schedule: string;              // "every 5m" | "0 9 * * *" | "2026-06-01T09:00:00Z" | …
  name?: string;
  repeat?: number;               // null/0 = forever; auto-set to 1 for "once" schedules
  deliver?: "origin" | "local" | "telegram" | "discord" | "slack" | …;
  origin?: CronOrigin;
  workdir?: string;
}

export interface AgentCronOptions extends BaseCronOptions {
  noAgent?: false | undefined;
  prompt: string;                // required when no_agent is false
  skill?: string;
  skills?: string[];
  model?: string;
  provider?: string;
  baseUrl?: string;
  script?: string;               // optional pre-run data collection
  contextFrom?: string | string[];
  enabledToolsets?: string[];
}

export interface NoAgentCronOptions extends BaseCronOptions {
  noAgent: true;
  script: string;                // REQUIRED for noAgent
  prompt?: string;               // ignored
}
```

### Internal module layout

```
packages/sdk/src/internal/cron/
├── jobs.ts                      # job CRUD, validation, atomic writes
├── scheduler.ts                 # tick loop, _run_single_job dispatcher
├── run-script.ts                # _run_job_script — spawn + timeout
├── wake-gate.ts                 # _parse_wake_gate — JSON pickup
├── delivery.ts                  # platform-specific delivery
├── schedule-parser.ts           # parse_schedule — "every 5m", cron expression, ISO
└── locks.ts                     # ~/.theokit/cron/.tick.lock
```

### Persistence layout

```
~/.theokit/cron/
├── jobs.json                    # All jobs
├── .tick.lock                   # File lock
└── scripts/                     # User scripts (optional, just convention)
    └── log-watchdog.sh
```

### Optional peer dependencies

| Dep | Why | When required |
|---|---|---|
| `croniter` (Node port: `cron` / `croner`) | Cron expression parsing | Always — required for schedule parsing |
| `proper-lockfile` | Tick lock file | Always |

### Migration impact on v1.2 users

- **Backward-compatible**: v1.2 had a `Cron` namespace from D7 (croner scheduler) and D8 (JSON persistence with atomic write). The `noAgent` option is additive. Existing `agent: true` jobs unaffected.
- **Breaking signature changes**: None.

## Test strategy

- `tests/cron/` — port Hermes' cron tests
- Unit tests: create_job validation (noAgent without script raises), schedule parsing, atomic writes, lock semantics
- Integration: real subprocess, real `jobs.json` round-trip, real schedule fire
- Property: for any sequence of CRUD operations, `jobs.json` is valid JSON
- Examples: `examples/cron-no-agent/` watchdog demo; `examples/cron-pre-run-script/` agent + script combo demo

## Open questions

- **Interpreter selection for `.js` / `.ts` scripts**: Node (or `tsx` for TS) seems natural for TheoKit. Document and ship a default.
- **Cron expression library**: Hermes uses `croniter`. Per D7 we already locked `croner` for TheoKit. Stick with `croner`.
- **`workdir` security**: a malicious script + workdir could escape into arbitrary paths. The agent that schedules cron jobs needs the same approval gate as terminal commands. Verify.
- **3-minute hard interrupt**: should TheoKit honor this? Probably yes. Make it configurable per-job.

## References

- `referencia/hermes-agent/cron/jobs.py:485-625` — create_job with no_agent
- `referencia/hermes-agent/cron/scheduler.py:1023-1124` — no_agent execution path
- `referencia/hermes-agent/cron/scheduler.py:815-835` — wakeAgent gate
- AGENTS.md:763-795 — cron architecture summary
- RELEASE_v0.13.0.md PR #19709 — no_agent mode
- RELEASE_v0.11.0.md PR #12373 — `wakeAgent` gate (predecessor)
- RELEASE_v0.11.0.md PR #14767 — per-job `enabled_toolsets`
- Theokit ADRs:
  - D7 — croner scheduler — already locked
  - D8 — JSON persistence + atomic write — already locked
