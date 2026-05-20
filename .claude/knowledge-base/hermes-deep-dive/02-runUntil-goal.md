# 02 — `/goal` Persistent Goals (Ralph Loop)

> A goal in Hermes is a free-form user objective that stays active across
> turns. After every agent turn the kernel asks an *auxiliary* model (the
> "judge") whether the goal is satisfied. If not, the kernel feeds a
> standardized user message back into the same session and runs another turn.
> Loops on turn budget, on consecutive parse failures from the judge, or on
> explicit user `/goal pause` / `/goal clear`. Persisted to SessionDB so
> `/resume` survives the goal. In TypeScript: `Agent.runUntil(goal,
> options?)` returns the same evaluate-judge-continue loop with an async
> generator of progress events.

## What problem this domain solves

The default agent shape is *turn-based*: the user sends a message, the agent runs `run_conversation()` until it stops (no more tool calls or budget exhausted), and the agent waits. The user must explicitly nudge with "keep going" / "are you done?" / "continue".

That falls apart for multi-step goals that the model itself does not realize span multiple turns. "Write the auth tests" looks like a single instruction; in practice it requires reading the existing code, planning, writing tests, running them, fixing failures — easily 5–10 model turns. Without a *persistent goal*, the user does the iteration manually.

A Ralph loop closes the loop. The kernel asks "is this done?" after every turn. If no, the kernel re-prompts. The agent works toward a goal autonomously until either it succeeds, declares itself blocked, or burns through the user's configured budget.

The harder problem is *bounding the loop*. A judge that always says "continue" is just a more polite infinite loop. The implementation has three backstops: a turn budget, a consecutive-parse-failure detector for weak judge models, and explicit user-pauseable state.

## Hermes file layout

| File | LoC | Role |
|---|---|---|
| `hermes_cli/goals.py` | 722 | All of it: `GoalState`, `GoalManager`, judge implementation, persistence, continuation prompts. |
| `cli.py` | (referenced) | `/goal`, `/subgoal` slash command handlers in `HermesCLI.process_command()`. |
| `hermes_cli/commands.py:105-107` | — | `COMMAND_REGISTRY` entries for `/goal` and `/subgoal`. |
| `gateway/run.py` | (referenced) | Gateway-side goal-loop integration. |
| `tui_gateway/server.py` | (referenced) | TUI JSON-RPC surface for goal status. |
| `website/docs/user-guide/features/goals.md` | 165 | User-facing docs (Persistent Goals page, RELEASE_v0.13 #18275). |
| `tests/hermes_cli/test_goals.py` | 740 | Unit tests covering judge parsing, state transitions, /subgoal. |
| `tests/cli/test_cli_goal_interrupt.py` | — | User-message-preempts-loop tests. |
| `tests/gateway/test_goal_max_turns_config.py` | — | Per-config turn budget tests. |
| `tests/gateway/test_goal_status_notice.py` | — | Status-line rendering tests. |
| `tests/gateway/test_goal_verdict_send.py` | — | Judge verdict event-emission tests. |
| `tests/tui_gateway/test_goal_command.py` | — | TUI integration tests. |

Confirmed with `wc -l hermes_cli/goals.py` (722) and `find -name "*goal*"`.

The module is **strictly bounded**: 722 LoC in one file, no hard dependency on `cli.HermesCLI` or the gateway runner (per the docstring at `goals.py:23-24`). CLI and gateway each wire their own `GoalManager` in.

## Canonical entry point

```python
# hermes_cli/goals.py:580
def evaluate_after_turn(
    self,
    last_response: str,
    *,
    user_initiated: bool = True,
) -> Dict[str, Any]:
    """Run the judge and update state. Return a decision dict.

    ``user_initiated`` distinguishes a real user prompt (True) from a
    continuation prompt we fed ourselves (False). Both increment
    ``turns_used`` because both consume model budget.

    Decision keys:
      - ``status``: current goal status after update
      - ``should_continue``: bool — caller should fire another turn
      - ``continuation_prompt``: str or None
      - ``verdict``: "done" | "continue" | "skipped" | "inactive"
      - ``reason``: str
      - ``message``: user-visible one-liner to print/send
    """
```

This is the function the CLI and gateway call after every `run_conversation()` returns. Everything else in the module (state, persistence, judge prompts) feeds into it.

## Happy path: user sets a goal, agent works to completion

```
USER (CLI): /goal write the auth tests and make them pass
  └─ hermes_cli/commands.py:105  CommandDef("goal", …, "Session", args_hint="<text>")
  └─ cli.py:HermesCLI.process_command()  resolves canonical "goal"
  └─ goal_manager.set("write the auth tests and make them pass")
       └─ hermes_cli/goals.py:482
       └─ GoalState(goal=…, status="active", turns_used=0, max_turns=20)
       └─ save_goal(session_id, state)
            └─ SessionDB.set_meta(f"goal:{session_id}", state.to_json())
  └─ User sees: "⊙ Goal (active, 0/20 turns): write the auth tests and make them pass"

USER does nothing else. The kernel auto-fires turn 1.

[turn 1 — kernel feeds the initial goal text as a normal user message]
  └─ Agent.run_conversation(user_message="write the auth tests…")
       └─ Calls tools (read_file, search_files, write_file …)
       └─ Returns: "Wrote tests/test_auth.py with 6 cases."

[After-turn hook]
  └─ goal_manager.evaluate_after_turn(last_response="Wrote tests/test_auth.py with 6 cases.")
       └─ hermes_cli/goals.py:580
       └─ state.turns_used = 1
       └─ verdict, reason, parse_failed = judge_goal(
              goal="write the auth tests and make them pass",
              last_response="Wrote tests/test_auth.py with 6 cases.",
              subgoals=[],
          )
            └─ hermes_cli/goals.py:334
            └─ get_text_auxiliary_client("goal_judge")  — task-pinned aux client
            └─ Builds judge prompt from JUDGE_SYSTEM_PROMPT + JUDGE_USER_PROMPT_TEMPLATE
                 (goals.py:84-104)
            └─ client.chat.completions.create(model=judge_model, messages=…, temperature=0,
                                              max_tokens=200, timeout=30s)
            └─ _parse_judge_response(raw)  — parses '{"done": false, "reason": "tests written but pass status unknown"}'
            └─ Returns ("continue", "tests written but pass status unknown", False)
       └─ verdict == "continue"
       └─ state.turns_used (1) < state.max_turns (20) → continue
       └─ state.consecutive_parse_failures = 0  (judge returned valid JSON)
       └─ continuation_prompt = next_continuation_prompt()
            └─ hermes_cli/goals.py:699
            └─ Returns CONTINUATION_PROMPT_TEMPLATE.format(goal="write the auth tests…")
                "[Continuing toward your standing goal]
                 Goal: write the auth tests and make them pass
                 Continue working toward this goal. Take the next concrete step. …"
       └─ Returns:
            {"status": "active",
             "should_continue": True,
             "continuation_prompt": "[Continuing toward your standing goal]…",
             "verdict": "continue",
             "reason": "tests written but pass status unknown",
             "message": "↻ Continuing toward goal (1/20): tests written but pass status unknown"}

[Kernel sees should_continue=True; auto-fires turn 2 with continuation_prompt as user message]
  └─ Agent.run_conversation(user_message="[Continuing toward your standing goal]…")
       └─ Agent: calls terminal tool to run `pytest tests/test_auth.py`
       └─ Sees 2 failures
       └─ Calls patch / write_file to fix
       └─ Re-runs pytest → "6 passed"
       └─ Returns: "All 6 auth tests pass."

[After-turn hook for turn 2]
  └─ goal_manager.evaluate_after_turn(last_response="All 6 auth tests pass.")
       └─ verdict, reason, _ = judge_goal(…)
            └─ Judge sees "All 6 auth tests pass." → returns {"done": true, "reason": "tests written and all pass"}
       └─ state.status = "done"
       └─ Returns: {"status": "done", "should_continue": False,
                    "verdict": "done", "reason": "tests written and all pass",
                    "message": "✓ Goal achieved: tests written and all pass"}

[Kernel stops the loop. CLI prints "✓ Goal achieved: tests written and all pass". State persisted as status=done.]
```

The whole loop never modified the system prompt. The agent saw the goal as a *user message* both times. **Prompt cache stays intact** — explicit in the module docstring at `goals.py:15-17`: "The continuation prompt is just a normal user message appended to the session via `run_conversation`. No system-prompt mutation, no toolset swap — prompt caching stays intact."

## Architectural decisions

### AD-1: Judge is an auxiliary LLM call, fail-OPEN

- **Decision**: After every turn, an auxiliary LLM is asked whether the goal is satisfied. The prompt is a strict JSON contract: `{"done": <bool>, "reason": "<text>"}`. Any judge error (API failure, timeout, unparseable output) returns `continue` — the loop keeps going, relying on the turn budget as the backstop.

- **Evidence**: `goals.py:356-360`:

  ```python
  This is deliberately fail-open: any error returns ``("continue", "...", False)``
  so a broken judge doesn't wedge progress — the turn budget and the
  consecutive-parse-failures auto-pause are the backstops.
  ```

  And the implementation at `goals.py:411-413`:

  ```python
  except Exception as exc:
      logger.info("goal judge: API call failed (%s) — falling through to continue", exc)
      return "continue", f"judge error: {type(exc).__name__}", False
  ```

- **Rationale**: A judge model that refuses to respond or returns garbage must not block agent progress. Worst case the agent runs to the turn budget and pauses. The user sees an explicit pause; the agent never silently stops.

- **Alternative rejected**: Fail-CLOSED (stop on judge error) would create user-visible pauses for transient network failures or rate limits — the wrong user experience.

- **TypeScript translation**: Same fail-open semantics. `judgeGoal()` returns `{ verdict: "continue", reason: "judge error", parseFailed: false }` on any error. The continue-by-default policy is *explicit* in the implementation, not accidental.

### AD-2: Goal text is appended as a *user message*, never a system prompt mutation

- **Decision**: The continuation prompt is a normal user-role message. The agent's system prompt is never touched.

- **Evidence**: Module docstring `goals.py:13-17`:

  ```
  Design notes / invariants:
  - The continuation prompt is just a normal user message appended to the
    session via ``run_conversation``. No system-prompt mutation, no toolset
    swap — prompt caching stays intact.
  ```

- **Rationale**: Cross-references `AGENTS.md:840-851` ("Prompt Caching Must Not Break"). System-prompt mutation forces a fresh cache key for every turn, dramatically increasing cost (often 5–10× for long conversations). User-message appending is *cheap* — it keeps the system prefix cached.

- **Alternative rejected**: Injecting the goal into the system prompt would have been simpler API-wise (one place to look) but would break prompt caching. The Hermes team explicitly rejected this pattern.

- **TypeScript translation**: `Agent.runUntil(goal)` builds continuation prompts as user messages via `agent.send(continuationText)`. The Agent's underlying system prompt is *immutable* per session. This matches Hermes' invariant.

### AD-3: Turn budget is the hard backstop; default 20

- **Decision**: A goal has a maximum number of turns (`max_turns`, default 20). When `turns_used >= max_turns`, the goal auto-pauses with a clear message. User must `/goal resume` (which resets the budget) or `/goal clear` (which abandons).

- **Evidence**: `goals.py:46` `DEFAULT_MAX_TURNS = 20`. And `goals.py:671-685`:

  ```python
  if state.turns_used >= state.max_turns:
      state.status = "paused"
      state.paused_reason = f"turn budget exhausted ({state.turns_used}/{state.max_turns})"
      save_goal(self.session_id, state)
      return {
          "status": "paused",
          "should_continue": False,
          ...
          "message": (
              f"⏸ Goal paused — {state.turns_used}/{state.max_turns} turns used. "
              "Use /goal resume to keep going, or /goal clear to stop."
          ),
      }
  ```

- **Rationale**: A runaway judge that always says continue would otherwise consume model tokens forever. 20 turns balances "enough to get real work done" against "not enough to cost serious money on an accidental loop."

- **Alternative rejected**: No budget. A goal that took 200 turns happened in v0.13 testing per PR #21287 ("honor configured goal turn budget"). The default existed but wasn't being honored — a regression. Now defended both at default and at config level (`agent.goal_max_turns`).

- **TypeScript translation**: `Agent.runUntil(goal, { maxTurns: 20 })`. Default 20. Per RELEASE_v0.13.0.md PR #21287, *make sure config-level max_turns is respected* — easy to regress.

### AD-4: Consecutive parse failures auto-pause; transient errors don't count

- **Decision**: When the judge returns *unusable* output (empty body, non-JSON, prose) 3 times in a row, the loop auto-pauses with guidance to route the judge to a stricter model. API/transport errors do *not* count toward this — those are transient.

- **Evidence**: `goals.py:52-57`:

  ```python
  # After this many consecutive judge *parse* failures (empty output / non-JSON),
  # the loop auto-pauses and points the user at the goal_judge config. API /
  # transport errors do NOT count toward this — those are transient. This guards
  # against small models (e.g. deepseek-v4-flash) that cannot follow the strict
  # JSON reply contract; without it the loop runs until the turn budget is
  # exhausted with every reply shaped like `judge returned empty response` or
  # `judge reply was not JSON`.
  DEFAULT_MAX_CONSECUTIVE_PARSE_FAILURES = 3
  ```

  Trip logic at `goals.py:647-669`:

  ```python
  if state.consecutive_parse_failures >= DEFAULT_MAX_CONSECUTIVE_PARSE_FAILURES:
      state.status = "paused"
      state.paused_reason = (
          f"judge model returned unparseable output {state.consecutive_parse_failures} turns in a row"
      )
      save_goal(self.session_id, state)
      return {
          ...
          "message": (
              f"⏸ Goal paused — the judge model ({state.consecutive_parse_failures} turns) "
              "isn't returning the required JSON verdict. Route the judge to a stricter "
              "model in ~/.hermes/config.yaml:\n"
              "  auxiliary:\n"
              "    goal_judge:\n"
              "      provider: openrouter\n"
              "      model: google/gemini-3-flash-preview\n"
              "Then /goal resume to continue."
          ),
      }
  ```

- **Rationale**: Without this guard, a weak judge model returning prose ("Sure, let me think about that…") would burn the full 20-turn budget producing failed parses. The user would see "20/20 turns used" and not realize the *judge* was the broken component, not the agent. Explicit error message with config snippet teaches the user how to fix it.

- **Alternative rejected**: Counting any judge error toward the auto-pause threshold. Would trip on transient rate-limit errors, creating false positives.

- **TypeScript translation**: Same logic. `Agent.runUntil` tracks consecutive parse failures separately from transient errors. Auto-pause with actionable error message pointing users at `TheokitConfig.auxiliary.goalJudge`.

### AD-5: User messages mid-loop preempt the continuation

- **Decision**: When a real user message arrives while the loop is firing, it preempts the auto-continuation prompt. The user's message still counts toward `turns_used`.

- **Evidence**: `goals.py:18-23`:

  ```
  - When a real user message arrives mid-loop it preempts the continuation
    prompt and also pauses the goal loop for that turn (we still re-judge
    after, so if the user's message happens to complete the goal the judge
    will say ``done``).
  ```

  `evaluate_after_turn` parameter at `goals.py:584`: `user_initiated: bool = True`. Comment at `goals.py:587-589`: "Both increment `turns_used` because both consume model budget."

- **Rationale**: The user is the authority on their goal. If they interrupt with a clarification or a redirect, the goal loop should yield. After the user-initiated turn, the judge re-runs — if the user's message happened to complete the goal, the judge marks done.

- **TypeScript translation**: `Agent.runUntil(goal)` returns an async generator. The caller can interject user messages via the generator's input (a la generator protocol with `next(value)`). Each yielded event distinguishes auto-continuation from user-initiated.

### AD-6: Sub-goals (criteria) added mid-loop via `/subgoal`

- **Decision**: A separate `/subgoal <text>` command appends criteria to the active goal. Both the continuation prompt and the judge prompt switch to a *with-subgoals* template that lists numbered criteria. The judge must find concrete evidence for each criterion.

- **Evidence**: `goals.py:108-121` (with-subgoals judge template):

  ```python
  JUDGE_USER_PROMPT_WITH_SUBGOALS_TEMPLATE = (
      "Goal:\n{goal}\n\n"
      "Additional criteria the user added mid-loop (all must also be "
      "satisfied for the goal to be DONE):\n{subgoals_block}\n\n"
      "Agent's most recent response:\n{response}\n\n"
      "Decision: For each numbered criterion above, find concrete "
      "evidence in the agent's response that the criterion is "
      "satisfied. Do not accept generic phrases like 'all requirements "
      "met' or 'implying it was done' — require specific evidence (a "
      "file contents excerpt, an output line, a command result). If "
      "ANY criterion lacks specific evidence in the response, the goal "
      "is NOT done — return CONTINUE."
  )
  ```

  Subgoal management methods at `goals.py:533-576` (add/remove/clear/render).

- **Rationale**: A goal evolves. "Write auth tests" might mid-loop need "also add a CSRF test" without the user wanting to scrap the goal and start over. Sub-goals append; the judge holds the agent to *all* of them.

- **Alternative rejected**: Allow goal text editing instead of additive sub-goals. Editing the goal would re-anchor the judge's evaluation history and break "is this done?" continuity.

- **TypeScript translation**: `Agent.runUntil(goal, { criteria: ["test 1", "test 2"] })` initial; mid-loop `agent.addCriterion("test 3")` via the returned handle. Same with-subgoals prompt switch.

### AD-7: Goal state persists in SessionDB; `/resume` picks it up

- **Decision**: Goal state is stored in SessionDB's `state_meta` table keyed by `goal:<session_id>` (`goals.py:189-190`). When the user resumes a session, the goal is automatically loaded.

- **Evidence**: `goals.py:10-12`:

  ```
  State is persisted in SessionDB's ``state_meta`` table keyed by
  ``goal:<session_id>`` so ``/resume`` picks it up.
  ```

  Persistence layer at `goals.py:226-266` (load_goal / save_goal / clear_goal).

- **Rationale**: A user crashes their CLI mid-goal, restarts, runs `/resume` — the goal still drives the next turn. This is one of the key UX wins of the feature: durability across process boundaries.

- **TypeScript translation**: `GoalState` is stored in our SessionDB equivalent (`packages/sdk/src/internal/session-db/` per AD-8 in the state-persistence doc). Key format `goal:${sessionId}`. JSON-serialised state. `Agent.resume(sessionId)` re-instantiates the GoalManager.

### AD-8: GoalManager is decoupled from CLI / gateway

- **Decision**: `GoalManager` has zero hard dependency on `cli.HermesCLI` or the gateway runner. Both wire the same `GoalManager` in via dependency injection.

- **Evidence**: Module docstring `goals.py:23-26`:

  ```
  - This module has zero hard dependency on ``cli.HermesCLI`` or the gateway
    runner — both wire the same ``GoalManager`` in.
  ```

- **Rationale**: One implementation, multiple consumers (CLI, gateway, TUI, ACP). Tests can instantiate `GoalManager` directly without needing a full CLI rig.

- **TypeScript translation**: `GoalManager` (internal) is its own module under `packages/sdk/src/internal/goal/`. `Agent.runUntil` constructs one; the user never instantiates one directly. The same module powers any future TUI / gateway / dashboard integration.

### AD-9: Judge gets 4KB of the last response + 200-token cap on its own output

- **Decision**: Judge sees only `_JUDGE_RESPONSE_SNIPPET_CHARS = 4000` characters of the last response (`goals.py:49`). Judge's own output is capped at `max_tokens=200` (`goals.py:407`).

- **Evidence**: Direct in code. The character cap is at `goals.py:49`; the token cap at `goals.py:407`:

  ```python
  resp = client.chat.completions.create(
      model=model,
      messages=[...],
      temperature=0,
      max_tokens=200,
      timeout=timeout,
      extra_body=get_auxiliary_extra_body() or None,
  )
  ```

- **Rationale**: Cost. A judge call is fired *every turn*. 4KB context + 200 token output keeps each judge call under a cent on most model pricing. Temperature 0 ensures consistent verdicts.

- **TypeScript translation**: Same caps. Exposed as configuration: `judge.responseSnippetChars` (default 4000), `judge.maxTokens` (default 200), `judge.temperature` (default 0), `judge.timeoutSeconds` (default 30).

### AD-10: Goal verdict reasons surface in `status_line`

- **Decision**: After each judge call, the verdict reason is stored on the state and shown in the status line. Users can ask `/goal` (no args) at any time and see *why* the loop is in its current state.

- **Evidence**: `status_line` at `goals.py:465-478`:

  ```python
  def status_line(self) -> str:
      s = self._state
      if s is None or s.status in {"cleared",}:
          return "No active goal. Set one with /goal <text>."
      turns = f"{s.turns_used}/{s.max_turns} turns"
      sub = f", {len(s.subgoals)} subgoal{'s' if len(s.subgoals) != 1 else ''}" if s.subgoals else ""
      if s.status == "active":
          return f"⊙ Goal (active, {turns}{sub}): {s.goal}"
      if s.status == "paused":
          extra = f" — {s.paused_reason}" if s.paused_reason else ""
          return f"⏸ Goal (paused, {turns}{sub}{extra}): {s.goal}"
      if s.status == "done":
          return f"✓ Goal done ({turns}{sub}): {s.goal}"
      return f"Goal ({s.status}, {turns}{sub}): {s.goal}"
  ```

- **Rationale**: Transparency. The user should always be able to ask the system "where are we?" without grep-ing logs.

- **TypeScript translation**: `Agent.getGoalStatus(): GoalStatusInfo` returns a structured object. Plus `goalStatusLine()` method for human-readable rendering matching Hermes' format.

## Data structures

### Persisted

**Path**: SessionDB (the SQLite session DB used by all of Hermes — see `10-state-persistence.md`). Specifically the `state_meta` table.

**Key format**: `goal:<session_id>` (`goals.py:190`).

**Format**: JSON-serialised `GoalState` dataclass.

**Schema** (verbatim from `goals.py:129-172`):

```python
@dataclass
class GoalState:
    goal: str
    status: str = "active"          # active | paused | done | cleared
    turns_used: int = 0
    max_turns: int = DEFAULT_MAX_TURNS  # 20
    created_at: float = 0.0
    last_turn_at: float = 0.0
    last_verdict: Optional[str] = None        # "done" | "continue" | "skipped"
    last_reason: Optional[str] = None
    paused_reason: Optional[str] = None       # why we auto-paused
    consecutive_parse_failures: int = 0       # judge-output parse failures in a row
    subgoals: List[str] = field(default_factory=list)
```

**Lifecycle**:
- Created on `/goal <text>` via `GoalManager.set()`.
- Mutated on every turn via `evaluate_after_turn` (turn count, verdict, reason).
- Status transitions: `active` → `paused` (budget exhausted, judge unparseable, user `/goal pause`), `active` → `done` (judge verdict), `active` → `cleared` (user `/goal clear`), `paused` → `active` (user `/goal resume`).
- Never deleted — `cleared` status preserves the record for audit. From `goals.py:260-266`:

  ```python
  def clear_goal(session_id: str) -> None:
      """Mark a goal cleared in the DB (preserved for audit, status=cleared)."""
      state = load_goal(session_id)
      if state is None:
          return
      state.status = "cleared"
      save_goal(session_id, state)
  ```

**Example** (constructed):

```json
{
  "goal": "write the auth tests and make them pass",
  "status": "done",
  "turns_used": 4,
  "max_turns": 20,
  "created_at": 1715000000.123,
  "last_turn_at": 1715000180.456,
  "last_verdict": "done",
  "last_reason": "all 6 auth tests pass per pytest output",
  "paused_reason": null,
  "consecutive_parse_failures": 0,
  "subgoals": ["also add a CSRF test"]
}
```

### In-memory

`GoalState` (above) — the only persistent shape. `GoalManager` (the orchestrator) holds one `GoalState` reference + a `session_id`. Module-level `_DB_CACHE: Dict[str, Any]` caches one SessionDB instance per `hermes_home` path (`goals.py:193`) to avoid thrashing the file.

### Concurrency model

- **Single-process per session.** The CLI and gateway each instantiate one `GoalManager` per active session. No cross-process coordination needed — only one writer per session at a time.
- **No locks.** SessionDB's `set_meta` handles its own write transaction (per the SessionDB docs in `hermes_state.py`).
- **No async primitives.** `GoalManager` is pure synchronous Python. The judge call is the only network IO and it is blocking; the run loop awaits it before deciding to continue.

## Failure modes Hermes already fixed

### 1. Judge returns prose instead of JSON

- **What can go wrong**: A weak judge model (e.g. `deepseek-v4-flash`) returns "Yes, the goal is done, let me explain why…" instead of the strict JSON contract. Naïve parsing fails; without a guard the loop burns 20 turns of failed parses.
- **How Hermes handles it**: `_parse_judge_response` at `goals.py:285-331` tries two recovery strategies before giving up: (1) strip markdown code fences (`goals.py:300-305`), (2) regex-search for `\{.*?\}` (`goals.py:282, 313-317`). If both fail, returns `(False, "judge reply was not JSON: …", parse_failed=True)`.
- **Plus**: After 3 consecutive `parse_failed=True`, auto-pause (AD-4).

### 2. Judge API call fails (rate limit, timeout, network)

- **What can go wrong**: Transient API failure to the judge provider.
- **How Hermes handles it**: `judge_goal` at `goals.py:411-413` catches *any* exception, logs at INFO level, returns `("continue", f"judge error: {type(exc).__name__}", False)`. `parse_failed=False` ensures the counter doesn't increment.

### 3. Empty agent response (model returns "" )

- **What can go wrong**: Model returns an empty assistant message. Calling the judge on empty input is wasteful.
- **How Hermes handles it**: `judge_goal` short-circuits at `goals.py:362-366`:

  ```python
  if not last_response.strip():
      # No substantive reply this turn — almost certainly not done yet.
      return "continue", "empty response (nothing to evaluate)", False
  ```

### 4. SessionDB unavailable at GoalManager construction

- **What can go wrong**: SessionDB import fails (test rigs, non-standard launchers). Without a DB, persistence is impossible but the loop should still work *in-memory*.
- **How Hermes handles it**: `_get_session_db` at `goals.py:196-223` catches every failure mode and returns `None`. `load_goal` / `save_goal` then no-op gracefully (`goals.py:230-258`). The loop still operates correctly within a single process — just doesn't survive restarts.

### 5. JSON in markdown fences

- **What can go wrong**: Judge returns ` ```json\n{"done": true, "reason": "…"}\n``` ` (with triple-backtick markdown). Naïve parsing fails.
- **How Hermes handles it**: `_parse_judge_response` at `goals.py:300-305` peels markdown code fences before parsing:

  ```python
  if text.startswith("```"):
      text = text.strip("`")
      nl = text.find("\n")
      if nl != -1:
          text = text[nl + 1:]
  ```

### 6. JSON object embedded in prose

- **What can go wrong**: Judge replies "Sure, here's my verdict: `{"done": false, "reason": "..."}`" — JSON is *inside* prose, not the whole reply.
- **How Hermes handles it**: Fallback regex `_JSON_OBJECT_RE = re.compile(r"\{.*?\}", re.DOTALL)` at `goals.py:282` finds the first JSON object in the response, then parses just that. Two-pass design — try whole, then try extracted.

### 7. User-supplied `done` field as a string

- **What can go wrong**: Judge model returns `{"done": "true"}` (string instead of bool).
- **How Hermes handles it**: `goals.py:323-327`:

  ```python
  done_val = data.get("done")
  if isinstance(done_val, str):
      done = done_val.strip().lower() in {"true", "yes", "1", "done"}
  else:
      done = bool(done_val)
  ```

  Treats `"true"`, `"yes"`, `"1"`, `"done"` all as truthy.

### 8. Pre-#21287: goal_max_turns config not honored

- **What can go wrong**: PR #21287 fix says "honor configured goal turn budget" — implying earlier code ignored `agent.goal_max_turns` and always used the hardcoded default of 20.
- **How Hermes handles it**: `GoalManager.__init__` at `goals.py:448` takes `default_max_turns: int = DEFAULT_MAX_TURNS`. The CLI and gateway *must* read the config and pass it in. Pre-#21287, they didn't.
- **TypeScript lesson**: Make this hard to get wrong. `Agent.runUntil(goal)` reads `this.config.agent.goalMaxTurns` automatically; the option overrides if explicitly passed.

### 9. Subgoals load as non-list (backward-compat)

- **What can go wrong**: Old state_meta rows (pre-/subgoal feature) have no `subgoals` field. Naïve `GoalState.from_json` would `KeyError`.
- **How Hermes handles it**: `GoalState.from_json` at `goals.py:156-159` defaults to `[]` if missing or non-list:

  ```python
  raw_subgoals = data.get("subgoals") or []
  subgoals: List[str] = []
  if isinstance(raw_subgoals, list):
      subgoals = [str(s).strip() for s in raw_subgoals if str(s).strip()]
  ```

### 10. Reason field absent (some judges omit it)

- **What can go wrong**: Judge returns `{"done": false}` without `reason`.
- **How Hermes handles it**: `goals.py:328-330`:

  ```python
  reason = str(data.get("reason") or "").strip()
  if not reason:
      reason = "no reason provided"
  ```

## TypeScript API proposal

### Public surface (added to `@usetheo/sdk`)

```typescript
// src/index.ts
// (Agent already exists from v1.2 — we extend its surface)
import { Agent } from "./agent";

// New method on Agent:
declare module "./agent" {
  interface Agent {
    /**
     * Run an autonomous Ralph loop toward a goal.
     *
     * After each turn, an auxiliary "judge" model decides whether the goal
     * is satisfied. If not, a continuation prompt is fed back into the
     * session as a user message (preserves prompt cache).
     *
     * Yields events for: turn start, agent response, judge verdict, status
     * changes (active|paused|done|cleared), and continuation prompts.
     *
     * Loops on:
     * - judge verdict "done"
     * - turn budget reached
     * - 3 consecutive judge parse failures
     * - user calls handle.pause() or handle.clear()
     */
    runUntil(goal: string, options?: RunUntilOptions): AsyncIterable<GoalEvent>;
  }
}

// src/agent/run-until.ts — public types
export interface RunUntilOptions {
  /** Max turns before auto-pause. Default 20. */
  maxTurns?: number;
  /** Initial criteria appended to the goal. */
  criteria?: string[];
  /** Override the auxiliary client used for the judge call. */
  judge?: {
    /** Provider override (defaults to TheokitConfig.auxiliary.goalJudge). */
    provider?: string;
    /** Model override. */
    model?: string;
    /** Timeout for judge call in milliseconds. Default 30000. */
    timeoutMs?: number;
    /** Cap on judge output tokens. Default 200. */
    maxTokens?: number;
    /** Cap on response text included in judge input (chars). Default 4000. */
    responseSnippetChars?: number;
  };
  /** AbortSignal to cancel the loop. */
  signal?: AbortSignal;
}

export type GoalEventKind =
  | "turn_start"
  | "agent_response"
  | "judge_verdict"
  | "continuation"
  | "status_change";

export interface GoalEvent {
  kind: GoalEventKind;
  turn: number;
  status: GoalStatus;
  message?: string;
  verdict?: GoalVerdict;
  reason?: string;
  agentResponse?: string;
  continuationPrompt?: string;
}

export type GoalStatus = "active" | "paused" | "done" | "cleared";
export type GoalVerdict = "done" | "continue" | "skipped" | "inactive";

export interface GoalStatusInfo {
  goal: string;
  status: GoalStatus;
  turnsUsed: number;
  maxTurns: number;
  lastVerdict: GoalVerdict | null;
  lastReason: string | null;
  pausedReason: string | null;
  criteria: string[];
  statusLine: string; // Human-readable, matches Hermes' format
}

// Goal management methods on Agent:
declare module "./agent" {
  interface Agent {
    addCriterion(text: string): Promise<void>;
    removeCriterion(indexOneBased: number): Promise<void>;
    clearCriteria(): Promise<number>;
    pauseGoal(reason?: string): Promise<void>;
    resumeGoal(opts?: { resetBudget?: boolean }): Promise<void>;
    clearGoal(): Promise<void>;
    getGoalStatus(): Promise<GoalStatusInfo | null>;
  }
}
```

### Example usage

```typescript
import { Agent } from "@usetheo/sdk";

const agent = await Agent.create({ /* … */ });

// One-shot autonomous loop
for await (const event of agent.runUntil(
  "write the auth tests and make them pass",
  { maxTurns: 20 },
)) {
  if (event.kind === "judge_verdict") {
    console.log(`Judge: ${event.verdict} — ${event.reason}`);
  } else if (event.kind === "status_change") {
    console.log(event.message);  // "✓ Goal achieved: …"  or  "⏸ Goal paused — …"
  }
}

// Status query mid-loop
const status = await agent.getGoalStatus();
console.log(status?.statusLine);

// Mid-loop sub-goal append (from another async path)
await agent.addCriterion("also add a CSRF test");
```

### Internal module layout

```
packages/sdk/src/internal/goal/
├── state.ts          # GoalState type + JSON serialization
├── persistence.ts    # SessionDB-backed load_goal/save_goal/clear_goal
├── manager.ts        # GoalManager class (state + evaluate_after_turn)
├── judge.ts          # judge_goal + _parse_judge_response
├── prompts.ts        # CONTINUATION_PROMPT_TEMPLATE constants (verbatim from Hermes)
└── index.ts          # Public re-exports for the Agent.runUntil entry
```

### Persistence layout

Same SessionDB as everything else (see `10-state-persistence.md`):

- Table: `state_meta` (key TEXT PRIMARY KEY, value TEXT)
- Key: `goal:${sessionId}`
- Value: JSON-serialised `GoalState`

### Optional peer dependencies

None new. The judge is a standard LLM call via the agent's existing auxiliary client (the same one used for compression, vision, session_search).

### Migration impact on v1.2 users

- **Backward-compatible**: Yes. `Agent.runUntil` is a new method; existing `Agent.send` etc. unchanged.
- **Breaking signature changes**: None.
- **Migration path**: Users opt in by calling `Agent.runUntil(goal)` instead of `agent.send(message)` in a loop.
- **Config additions** (non-breaking): `theokit.config.yaml` gains `agent.goalMaxTurns` (default 20) and `auxiliary.goalJudge` (provider/model overrides for the judge call). Users who don't set them get the defaults.

## Test strategy (mirrors Hermes' approach)

Hermes test files to port:

- `tests/hermes_cli/test_goals.py` (740 LoC) — comprehensive unit tests covering judge parsing, state transitions, /subgoal CRUD, max_turns enforcement, parse-failure auto-pause.
- `tests/cli/test_cli_goal_interrupt.py` — user-message-mid-loop preemption.
- `tests/gateway/test_goal_max_turns_config.py` — config-level max_turns wiring (regression for PR #21287).
- `tests/gateway/test_goal_status_notice.py` — status line rendering.
- `tests/gateway/test_goal_verdict_send.py` — verdict event emission to gateway.
- `tests/tui_gateway/test_goal_command.py` — TUI integration.

**Unit tests**:
- `_parse_judge_response`: 20+ cases — well-formed JSON, JSON in markdown fences, JSON in prose, empty string, prose-only, malformed JSON, string "true"/false, missing reason, etc.
- `evaluate_after_turn`: state transitions for each verdict × status × budget condition.
- `add_subgoal` / `remove_subgoal`: index validation, empty text, no active goal raises RuntimeError.
- `GoalState.from_json`: legacy rows without `subgoals`, with `subgoals` as non-list, all valid combinations.

**Integration tests**:
- Real SQLite SessionDB. Set a goal, simulate 5 turns, verify state persisted correctly across "process restarts" (close/open the SessionDB).
- `/resume` integration: create goal, simulate process death, instantiate a new GoalManager from same session, verify state loaded.

**Property tests** (`fast-check`):
- For any sequence of valid operations (set/add_criterion/pause/resume/clear), the GoalState invariants hold (turns_used ≤ max_turns, status one of active/paused/done/cleared, etc.).

**Real-LLM tests** (per `.claude/rules/real-llm-validation.md`):
- Full end-to-end: real OpenAI/Anthropic/OpenRouter judge, real agent, give a known-completable goal, assert loop terminates with `done` verdict within 5 turns.
- Adversarial: configure a deliberately-broken judge (e.g. a model that always returns prose), assert the parse-failure auto-pause trips after exactly 3 turns.

**Examples to ship**:
- `examples/goal-quickstart/` — single goal, agent works to completion, prints events.
- `examples/goal-with-criteria/` — goal + 2 sub-criteria added mid-loop.
- `examples/goal-paused-resume/` — show the paused state when budget exhausts; resume; show completion.

## Open questions

- **Per-turn cost**: each turn fires a judge call. For a 20-turn loop on a paid judge model, that's 20 extra LLM calls. Is this acceptable for v1.3, or do we offer a `judge: { interval: "every-n-turns" }` option? Hermes doesn't have this; the judge fires every turn. Recommend mirroring Hermes' behavior in v1.3 and considering interval-based judging in v1.4 if cost becomes a complaint.

- **AbortSignal propagation**: Hermes uses interrupt-checks in the run loop. For TypeScript, `AbortSignal` is idiomatic. Where do we plumb it — at every `agent.send` call, or only at the loop level?

- **Mid-loop user messages**: in Hermes (CLI + gateway), a user message arriving asynchronously preempts the continuation. In our SDK, `Agent.runUntil` returns an async iterable — how does the caller inject a user message mid-loop? Three options:
  1. Caller calls `agent.send(text)` separately on another reference to the same agent.
  2. The async iterable accepts injected user messages via the generator protocol (`iter.next(value)`).
  3. Caller passes a `userMessageStream: AsyncIterable<string>` option that is consumed alongside auto-continuations.

  Option (1) is simplest. Option (3) is most TypeScript-idiomatic.

- **Subagent's goal interaction**: if a parent agent calls `delegate_task` with a sub-agent, does the sub-agent inherit the goal? Hermes' implementation is silent (probably no; the goal is session-scoped). For TypeScript: explicitly no — subagents do not see the parent's goal.

## References

- `referencia/hermes-agent/hermes_cli/goals.py:1-722` (the entire module)
- `referencia/hermes-agent/hermes_cli/commands.py:105-107` — slash command registration
- `referencia/hermes-agent/RELEASE_v0.13.0.md:14, 122-125, 535` — feature announcement and docs page
- `referencia/hermes-agent/website/docs/user-guide/features/goals.md` (165 LoC) — user-facing documentation
- `AGENTS.md:840-851` — prompt cache invariants the design must preserve
- Theokit ADRs this domain interacts with:
  - D22 — `Agent.getOrCreate` semantics — the session-resume flow that picks up persisted goals
  - D33 — `Agent.generateObject` via synthetic forced tool — *not* used here (judge uses plain text + JSON parsing)
  - D34 — Telemetry: OTel spans, privacy-by-default — judge call should be span'd as `goal.judge` for observability
