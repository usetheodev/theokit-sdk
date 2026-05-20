# 00 — Orientation

> Notes from the orientation pass: README.md, AGENTS.md, and all 12 release
> notes (v0.2.0 → v0.13.0). Reads sequentially as a briefing for any engineer
> who has not touched the Hermes codebase before. The signal-to-noise rule:
> capture what shapes design, not what shipped.

## Codebase reality check

| Fact | Value | Where I confirmed |
|---|---|---|
| Total Python LoC | **811,547** across **1,681 files** | `find … -name "*.py" \| wc -l` + `wc -l` total |
| Test count claimed in AGENTS.md (`tests/conftest.py`) | "~17k tests across ~900 files as of May 2026" | `AGENTS.md:62` |
| Releases on disk | v0.2.0 through v0.13.0 (v0.1 not included) | `ls RELEASE_v*.md` |
| First public release | v0.2.0 — March 12, 2026 — 216 PRs, 63 contributors | `RELEASE_v0.2.0.md:5` |
| Latest release | v0.13.0 — May 7, 2026 — 588 PRs, 295 contributors | `RELEASE_v0.13.0.md:4` |
| Release cadence | Roughly weekly (8 weeks, 12 minor releases) | release-note dates |
| Single largest file | `hermes_state.py` — 126,726 bytes ≈ 2,966 LoC | `ls -la hermes_state.py` |
| License | MIT | `RELEASE_v0.2.0.md:11`, `README.md:193` |
| Maintainer | Nous Research, lead `@teknium1` | `README.md`, every release |

The briefing prompt asserted **~411k LoC**; reality is **~811k LoC** — nearly double. Most of the delta sits in `cli.py` (622,893 bytes, the largest single Python file), the gateway adapters (61 files across 22 platforms), and the skills tree (`skills/` + `optional-skills/`). The cited number was likely a stale figure from an earlier release. **All subsequent design-decision counts in this deep-dive are anchored to current source, not the prompt's number.**

## What Hermes is, in one sentence

A self-improving AI agent platform built around an `AIAgent` core loop (`run_agent.py`, ~12k LoC, ~60-parameter `__init__`), wrapped in a multi-platform gateway (22 messaging adapters), an extensible tool registry (98 Python files under `tools/`), a plugin discovery layer (general + memory-provider + model-provider, three separate scan systems), an autonomous skill curator, and seven terminal execution backends. Distributed under MIT.

## How the project was assembled, in one chart

| Release | Date | Theme | Defining feature |
|---|---|---|---|
| v0.2.0 | 2026-03-12 | The foundation | First centralized provider router (`call_llm` API, PR #1003), filesystem checkpoints + `/rollback`, Honcho integration (#38), Daytona backend (#451) |
| v0.3.0 | 2026-03-17 | Streaming + plugins | First-class plugin architecture (#1544, #1555), native Anthropic provider, persistent shell mode, `cronjob` single tool, cron sessions in SQLite (#1255) |
| v0.4.0 | 2026-03-23 | Platform expansion | OpenAI-compatible API server (#1756), 6 new platforms, MCP OAuth 2.1 PKCE (#2465), gateway prompt caching (#2282), context compression overhaul (#2323) |
| v0.5.0 | 2026-03-28 | Hardening | Plugin lifecycle hooks activated (#3542), native Modal SDK (#3538), supply chain hardening (removed compromised `litellm`, #2796), `MemoryProvider` ABC refactor (#4623 — but this lands in v0.7) |
| v0.6.0 | 2026-03-30 | Multi-instance | **Profiles** (#3681) — each instance gets isolated `HERMES_HOME`, MCP server mode (#3795), ordered fallback provider chain (#3813), Feishu + WeCom platforms |
| v0.7.0 | 2026-04-03 | Resilience | **Pluggable memory provider interface** (#4623, ABC-based plugin system), credential pools with `least_used` rotation (#4188), Camofox browser backend, gateway approval routing through running-agent guard (#4798) |
| v0.8.0 | 2026-04-08 | Intelligence | Background process `notify_on_complete` (#5779), inactivity-based timeouts (#5389), Codex tool-use guidance via self-benchmarking (#6120), plugin CLI registration (#5295 — removed 95 lines of hardcoded honcho argparse), centralized logging (#5430) |
| v0.9.0 | 2026-04-13 | Everywhere | Local web dashboard, iMessage via BlueBubbles, WeChat/Weixin, Termux/Android, Fast Mode (`/fast`), `watch_patterns` background monitoring (#7635), `hermes backup`/`import` (#7997), unified spawn-per-call execution layer (#6343) |
| v0.10.0 | 2026-04-16 | Tool gateway | Nous Tool Gateway for paid subscribers (#11206) — single PR release, rest deferred to v0.11 |
| v0.11.0 | 2026-04-23 | Interface | New **Ink/React TUI** (`hermes --tui`), **Transport ABC** (`agent/transports/`, #13347), 5 new inference paths incl. AWS Bedrock, plugin surface expansion (`register_command`, `dispatch_tool`, `pre_tool_call` veto, `transform_tool_result`), `/steer` mid-run nudges (#12116), shell hooks (#13296), orchestrator role + `max_spawn_depth` (#13691), cron `wakeAgent` gate (#12373), QQBot platform |
| v0.12.0 | 2026-04-30 | Curator | **Autonomous Curator** (`hermes curator`, #17277) on cron ticker with 7-day cycle, **self-improvement loop upgraded** (class-first rubric, active-update bias, fork inherits parent runtime, scoped toolsets), **pluggable gateway platforms** + Teams plugin (#17751), Vercel Sandbox backend (#17445), trigram FTS5 for CJK (#16651), checkpoint orphan/stale shadow auto-prune (#16303), secret redaction OFF by default (#16794), TUI cold start cut ~57% |
| v0.13.0 | 2026-05-07 | Tenacity | **Multi-agent Kanban** (durable, #17805 — reimplemented after v0.12 revert #16098), **`/goal`** Ralph loop primitive (#18262), **Checkpoints v2** rewrite (#20709), **`no_agent` cron mode** (#19709), **`ProviderProfile` ABC** as pluggable surface (#20324, salvage of #14424), session auto-resume after restart (#21192), redaction ON by default again (#21193, 8 P0 security closures), Google Chat platform (20th), 7 i18n locales |

Two observations matter for v1.3 scoping:

1. **The 9 v1.3 features map almost 1-to-1 onto v0.13 highlights.** They are the freshest, most ambitious, and *least battle-tested* part of Hermes — half were rewrites of prior attempts. That biases what we have to verify.
2. **The mainline rewrite pattern is consistent.** Almost every "v2" feature in Hermes (compression overhaul v0.4, memory provider plugin v0.7, transport ABC v0.11, gateway-as-plugin-host v0.12, kanban v0.13, checkpoints v2 v0.13, provider plugin v0.13) is the second or third attempt at the same shape, with the first attempt either reverted or refactored.

## What I should not be looking for

- A **stable** Kanban API. It landed (#16081 in v0.12), was **reverted** (#16098), then re-landed in v0.13 (#17805) with multi-profile design. The post-revert version is what shipped. The pre-revert version is dead code.
- A **clean** ProviderProfile ABC. It is in `plugins/model-providers/` (per AGENTS.md `:528`) but provider discovery is a **lazy, separate** system from the general PluginManager (AGENTS.md `:530-549`). Last-writer-wins on `register_provider()`. This is the rough edge.
- A **memory-provider plugin** I can borrow. The set is closed by policy as of May 2026 (AGENTS.md `:515-525`): "New memory backends must ship as **standalone plugin repos**". Bug fixes to in-tree providers are still welcome.

## Architecturally load-bearing decisions

These are the patterns I will be re-implementing in TypeScript, not skipping past.

### `AIAgent.run_conversation()` is the synchronous core loop

`AGENTS.md:84-140` documents the loop:

```python
while (api_call_count < self.max_iterations and self.iteration_budget.remaining > 0) \
        or self._budget_grace_call:
    if self._interrupt_requested: break
    response = client.chat.completions.create(model=model, messages=messages, tools=tool_schemas)
    if response.tool_calls:
        for tool_call in response.tool_calls:
            result = handle_function_call(tool_call.name, tool_call.args, task_id)
            messages.append(tool_result_message(result))
        api_call_count += 1
    else:
        return response.content
```

This loop is "**entirely synchronous, with interrupt checks, budget tracking, and a one-turn grace call**" (AGENTS.md:122). Subagents inherit the same loop with their own iteration budgets (v0.5 #3004). The shared-budget bug that caused premature exits in v0.4 was fixed by giving subagents *independent* budgets — important constraint for kanban workers.

The loop runs in a single thread. Concurrency in Hermes lives at the *layer above* the loop: ThreadPoolExecutor for parallel tool execution (v0.3 #1152), per-thread persistent event loops in worker threads (v0.4 #2214), `contextvars` for session state (v0.9 #7454).

**TypeScript translation**: The Agent loop is `async`. We do not need `asyncio.Lock` analogues for the loop itself — JavaScript's single-threaded event loop is the analogue. We *do* need explicit primitives for parallel tool execution (`Promise.all` with a concurrency limiter), file-system races (cross-agent state coordination, v0.11 #13718), and database access (`better-sqlite3` is synchronous-blocking).

### Plugin discovery is three separate systems

AGENTS.md `:467-562` is explicit:

1. **General plugins** — `PluginManager` discovers from `~/.hermes/plugins/`, project plugins, pip entry points. Side effect of importing `model_tools.py`. Idempotent `discover_plugins()` available for non-`model_tools.py` paths (AGENTS.md `:487-489`).
2. **Memory-provider plugins** — Separate `agent/memory_manager.py` orchestration. `MemoryProvider` ABC (`agent/memory_provider.py`). Lifecycle hooks: `sync_turn`, `prefetch`, `shutdown`, optional `post_setup`. **Policy May 2026: closed in-tree.**
3. **Model-provider plugins** — `plugins/model-providers/<name>/__init__.py` calls `providers.register_provider(ProviderProfile(...))` at module load. **Lazy** scan triggered by `get_provider_profile()` or `list_providers()`. Last-writer-wins (user plugins override bundled). General PluginManager records these manifests but does **not** import them.

PR #5295 (v0.8) removed 95 lines of hardcoded honcho argparse from `main.py` after Teknium's hard rule (AGENTS.md `:509-513`): "plugins MUST NOT modify core files."

**TypeScript translation**: We will have **one** discovery system, not three. The general plugin manager (`Plugin` interface) hosts everything via narrowly-typed hook contracts (`onLLMCall`, `onToolCall`, etc.). Memory providers and model providers are *kinds* of plugins, not separate scan paths. Last-writer-wins is acceptable; we will surface the conflict with a warning instead of swallowing it silently.

### Persistence is JSON with atomic writes plus SQLite

Hermes uses **both**, with the cut at *transactional structured queries* vs *configuration and small records*.

**JSON + atomic write** (rename-into-place pattern):
- `~/.hermes/config.yaml` (v0.6 #3800)
- `~/.hermes/.env` (v0.2 #954)
- `~/.hermes/cron/jobs.json` (v0.2 #146)
- `~/.hermes/sessions.json` (legacy, v0.2 #611)
- Process checkpoints (v0.2 #298)
- Skill files (v0.2 #551)
- Batch runner state (v0.2 #297)
- `update-pending` state (v0.8 #4923)
- `save_job_output` (v0.3 #1173)
- Profile import tar archives (v0.7 #4318 validates member paths against zip-slip)

**SQLite** (`hermes_state.py`, 2966 LoC):
- Session messages with FTS5 search index (`hermes_state.py:SessionDB`)
- Cron sessions persisted (v0.3 #1255)
- Token usage per session (v0.7 #4627)
- Memory flush state (v0.7 #4481)
- API server `ResponseStore` (v0.4 #2472)
- Auto-prune old sessions + `VACUUM` at startup (v0.11 #13861)
- Schema versioning (v6 in v0.5 added `reasoning`, `reasoning_details`, `codex_reasoning_items` columns, #2974)
- FTS5 issues fixed: hyphenated queries (v0.4 #1776), search-all-sources default (v0.4 #1892), corrupt `load_transcript` lines (v0.4 #1744), case-sensitive duplicates (v0.4 #2157), no-sessions crash (v0.4 #2194), quote underscored terms (v0.12 #16915), quote dotted terms (v0.7 #4549), trigram CJK index (v0.12 #16651), index `tool_name`+`tool_calls` (v0.12 #16914), repair-and-migrate FTS5 schema drift (v0.12 #16914)
- WAL write-lock contention causing 15-20s TUI freeze fixed (v0.5 #3385)
- Concurrency hardening + transcript integrity (v0.5 #3249)
- Thread locks on 4 SessionDB methods (v0.4 #1704)

**TypeScript translation**: Same split. `JSON.stringify` + atomic rename for config and cron jobs; `better-sqlite3` for session messages + FTS5. The atomic-write pattern is `fs.writeFile(temp, data); fs.rename(temp, target)`; we will encapsulate in an `atomicWriteJson(path, value)` helper to match Hermes' discipline.

### Profile isolation rewrites every path lookup

`hermes_constants.get_hermes_home()` (AGENTS.md `:880-883`) returns the active profile's directory. `_apply_profile_override()` in `hermes_cli/main.py` sets `HERMES_HOME` *before any module imports* (AGENTS.md `:874-876`) — this is the load-bearing trick.

Five bugs fixed in PR #3575 came from hardcoded `~/.hermes` (AGENTS.md `:925-928`). Tests must `monkeypatch.setenv("HERMES_HOME", str(tmp_path))` AND `patch.object(Path, "home", lambda: tmp_path)` (AGENTS.md `:907-910`).

**TypeScript translation**: A single source-of-truth function `getTheokitHome(): string` reading `THEOKIT_HOME` env var with `~/.theokit` default. Everything below this is profile-relative. Tests get a fixture `withTempTheokitHome(fn)`. We do **not** copy the gateway-platform token-lock pattern verbatim (AGENTS.md `:912-916`) — that is gateway-runtime concern not SDK concern. But we should expose a `LockManager` interface so users can wire it if needed.

### Caching the system prompt is non-negotiable

AGENTS.md `:840-851`:

> Hermes-Agent ensures caching remains valid throughout a conversation. **Do NOT implement changes that would:**
> - Alter past context mid-conversation
> - Change toolsets mid-conversation
> - Reload memories or rebuild system prompts mid-conversation

> Cache-breaking forces dramatically higher costs. The ONLY time we alter context is during context compression.

Slash commands that mutate state default to *deferred invalidation* (next session); `--now` opts in (AGENTS.md `:849-851`).

**TypeScript translation**: This is a *contract on `Agent.send()`*, not just a hint. We will enforce it by giving `Agent.create()` immutable `tools`, `skills`, `memory` and exposing a `Agent.invalidateCache()` method that rebuilds — never mid-turn mutation. The `/goal` injection (v0.13 #12116) is precisely the kind of update that *does not* break cache, because the injection lands as a *user message* not a *system prompt change*. Our `Agent.runUntil()` must follow the same pattern.

### Tool registry is auto-discovery + manual toolset wiring

AGENTS.md `:264-308`:

- Every `tools/*.py` with a top-level `registry.register()` call is imported automatically (no manual import list).
- A tool is *exposed to an agent* only if its name appears in a toolset (`toolsets.py` `TOOLSETS` dict).
- `_HERMES_CORE_TOOLS` is the default bundle most platforms inherit from.
- Schemas are generated at import time, *after* `_apply_profile_override()` sets `HERMES_HOME`.
- All handlers MUST return a JSON string.
- Plugins register tools at `ctx.register_tool(...)`.

There is a process-global `_last_resolved_tool_names` in `model_tools.py` that `delegate_tool.py` saves and restores around subagent execution (AGENTS.md `:940-942`). This is a hazard area — any new code that reads this global may see stale values during child agent runs.

**TypeScript translation**: Tools are explicit registrations, not auto-discovery (this is TS, not Python — we do not have side-effect imports as idiom). We will provide a `defineTool(spec)` helper and a `Toolset` type. The "auto-discovery + manual toolset wiring" pattern translates to: developer imports each tool module explicitly, then chooses which subset to enable on the Agent. No process-global state.

### The cron file lock is the model

AGENTS.md `:783-790` documents:

- 3-minute hard interrupt on cron sessions.
- Catchup window: half the job's period, clamped to 120s–2h.
- Grace window: 120s for one-shot jobs whose fire time was missed.
- **File lock at `~/.hermes/cron/.tick.lock` prevents duplicate ticks across processes.**
- Cron sessions pass `skip_memory=True` by default.

The file-lock pattern (likely `portalocker` or `fcntl.flock`) is how Hermes coordinates multi-process tick agreement. The same pattern almost certainly recurs in kanban (heartbeat) and skill-writes (atomic file writes); we will verify in their respective domain docs.

**TypeScript translation**: Node has `proper-lockfile` and `lockfile` libraries; we will need to choose one. For SDK-internal locking (cron, kanban heartbeat) we will encapsulate behind an `IFileLock` interface so users can substitute their own implementation when running on platforms without flock (Windows, serverless).

### Memory providers were the prototype for the v1.3 plugin patterns

AGENTS.md `:491-507` documents `MemoryProvider` ABC + `MemoryManager` orchestrator. Lifecycle:

- `sync_turn(turn_messages)`
- `prefetch(query)`
- `shutdown()`
- `post_setup(hermes_home, config)` (optional, for setup-wizard integration)
- `on_memory_write` (added v0.11 #10507)

This shape — ABC + orchestrator + per-plugin directory + lifecycle hooks + optional setup-wizard integration — is the pattern that all three of our v1.3 ABCs (memory backend, execution backend, provider plugin) must match.

## Failure modes Hermes has actually shipped

This deep-dive is forensic; I want to enumerate every documented failure class up front. Most domains will deepen these.

### TOCTOU races (multiple closures in v0.13)
- MCP OAuth credential save TOCTOU (#21176, v0.13)
- `hermes_cli/auth.py` credential writers TOCTOU (#21194, v0.13)
- Cron `get_due_jobs` reads `jobs.json` twice (v0.4 #1716)
- Restart with `--replace` racing PID file (v0.4 #2406, #1908)

### Concurrent write corruption
- Memory provider concurrent writes silently dropping entries until file lock added (v0.4 #1726)
- MCP duplicate registration on concurrent file access (v0.4 #2154)
- Cron `get_due_jobs` parallel write corruption (v0.13 #19874)
- `PairingStore` thread safety (v0.8 #5656)
- `SessionStore._entries` protected with `threading.Lock` (v0.5 #3052)

### Zombie processes / stale locks
- Stale PID + lock file unlinks on cleanup (multiple PRs)
- Darwin zombie kanban workers (v0.13 #20188)
- Stopped processes + stale locks on `--replace` (v0.4 #2406)
- Orphaned browser sessions reaped on startup (v0.9 #7931)
- Worker shutdown race in kanban (v0.13 #21214)

### Hallucination and tool-call failure modes
- DeepSeek V3 dropping multi-line JSON tool args (v0.2 #444)
- DeepSeek V3 multiple parallel tool calls (v0.3 #1300)
- GPT/Codex describing intended actions instead of calling (v0.5 #5414, #5931, v0.8 #6120)
- Truncated streaming tool call detection (v0.9 #6847)
- Tool call repair middleware — auto-lowercase + invalid tool handler (v0.2)
- Coerce tool arg types to match JSON Schema (v0.8 #5265)
- Worker-created-card hallucination gate in kanban (v0.13 #20232)
- `<think>` blocks polluting responses (v0.2 #174, v0.3 + many follow-ups)

### Compression death spirals
- Compression triggers → fails → compresses again → infinite loop (v0.7 #4750, closes #2153)
- `compression_attempts` never resets (v0.4 #1723)
- Stale agent timeout, empty response after tools (v0.11 #10065)
- Empty-tools after tools, premature loop exit on weak models (v0.11 #10472)

### Path-traversal vectors
- Skill bundle paths (v0.7 #3986)
- Profile import tar zip-slip (v0.7 #4318)
- Skill category names (v0.6 #3844)
- Self-update zip-slip (v0.5 #3250)
- Cron prompt-injection scanner including skill content (v0.13 #21350)

### Cache-corruption / prompt cache breakage
- Stabilize system prompt across gateway turns for cache hits (v0.2 #754)
- Honcho recall kept out of cached system prefix (v0.3 #1201)
- Deterministic `call_id` fallbacks instead of random UUIDs for cache consistency (v0.7 #3991)
- Gateway prompt caching: AIAgent cached per session (v0.4 #2282)

### Disk-full / fs-permission / FD-leak
- File handle and socket fd leaks (v0.2 #568, #296, #709)
- Email connection leaks (v0.6 #3804)
- Email adapter `_seen_uids` unbounded growth (v0.5 #3490)
- httpx keepalive CLOSE_WAIT audit (v0.13 #18766)
- WhatsApp aiohttp leak (v0.13)
- Feishu hygiene (v0.13)

### Permission boundary violations
- Path traversal in `skill_view` (v0.2 #220)
- Shell injection in sudo password piping (v0.2 #65)
- Multi-word prompt injection bypass (v0.2 #192)
- Cron prompt injection scanner bypass (v0.2 #63)
- Symlink boundary in `skills_guard` (v0.2 #386)
- Symlink bypass in write deny list (v0.2 #61)
- Discord cross-guild DM bypass via shared role allowlist (v0.13 #21241, CVSS 8.1)
- WhatsApp accepts strangers by default → fixed (v0.13 #21291)
- Browser cloud-metadata SSRF floor (v0.13 #21228)

### Secret-redaction self-corruption
This one shipped twice and was reverted once:
- Patch tool corrupted terminalbench2 via false-positive secret redaction (v0.6 #3801)
- Secret redaction OFF by default (v0.12 #16794) — "stops corrupting patches / API payloads"
- Redaction back ON by default (v0.13 #21193) — with `code_file` skip param (v0.13 #19715) for ENV/JSON false positives
- O(n²) catastrophic backtracking in redact regex — 100x improvement (v0.8 #4962)

The redaction trip-back is **the canonical example** of why a v1.3 feature should NOT default to opt-out. If we add redaction, default off, opt in.

## Test discipline observations

AGENTS.md `:988-1077` is the ground truth for testing:

- **`scripts/run_tests.sh`** is the only sanctioned entry. Wrapper enforces:
  - All `*_API_KEY`/`*_TOKEN` unset
  - `TZ=UTC`, `LANG=C.UTF-8`
  - `-n 4` xdist workers (matches CI; > 4 surfaces ordering flakes CI never sees)
  - Hermetic `HERMES_HOME` per test via `tests/conftest.py:_isolate_hermes_home` autouse fixture
- **Profile tests** monkeypatch `Path.home` AND set `HERMES_HOME` (AGENTS.md `:973-985`).
- **Change-detector tests are explicitly banned** (AGENTS.md `:1033-1077`):

  > **Do not write:** `assert "gemini-2.5-pro" in _PROVIDER_MODELS["gemini"]`
  > **Do write:** `assert "gemini" in _PROVIDER_MODELS` + `assert len(_PROVIDER_MODELS["gemini"]) >= 1`

  Translation rule: "if the test reads like a snapshot of current data, delete it. If it reads like a contract about how two pieces of data must relate, keep it."

- **No tests may write to `~/.hermes/`** (AGENTS.md `:970-972`).

**TypeScript translation**: We have this discipline already in `theokit-sdk/CLAUDE.md`. The wrapper-script pattern translates to a `pnpm test` that pre-sets env via `dotenv-cli` or an inline `cross-env`. We do not need xdist parity since Vitest's worker count is configurable. We *do* need the autouse fixture analogue — a global `beforeEach` that swaps `THEOKIT_HOME` to a `os.tmpdir()` path.

## What changes between v0.10 and v0.13 (the freshest, least-tested code)

Per the prompt's instructions, features in v0.13 are *most* relevant for re-implementation AND *least* battle-tested. From the diffs:

| Feature shipped in | Source PR | What I should weight |
|---|---|---|
| `/goal` (Ralph loop) | v0.13 #18262 | Brand new primitive; only follow-up so far is `#21287` honoring configured turn budget. Untested at scale. |
| Multi-agent Kanban (durable) | v0.13 #17805 (post-revert reimpl) | The v0.12 first attempt was reverted (#16098). Many fix PRs already (#21183 heartbeat/reclaim/zombie, #21214 auto-block, #20232 hallucination gate, #20188 darwin zombies). **Highest risk area.** |
| Checkpoints v2 | v0.13 #20709 | Single-store rewrite "with real pruning + disk guardrails". Foundation v0.2 #824. Auto-prune at startup landed already in v0.12 #16303. |
| `no_agent` cron | v0.13 #19709 | Built on top of v0.11 #12373 `wakeAgent` gate. Simple enough — script-only, empty stdout = silent. Less risky. |
| `ProviderProfile` ABC | v0.13 #20324 | Salvage of v0.11 #14424 (a community PR that took 4 releases to land). Foundational for cross-provider parity. |
| Cross-session FTS5 | Mature (since v0.2 SessionDB) | Many incremental hardening PRs. Lowest risk for re-implementation — mature SQLite usage. |
| Dialectic user modeling | v0.2 Honcho + v0.7 MemoryProvider ABC | Mature plugin contract. Reference implementation `plugins/memory/honcho/`. |
| Autonomous skills | v0.12 Curator + background review fork | The "self-improvement loop" was already class-first rubric in v0.12. v0.13 added subcommands and synchronous manual run. Curator runs *every 7 days* — operationally rare. |
| 7 execution backends | Spread across v0.2–v0.12 | Daytona v0.2, Modal v0.5 (native SDK), Vercel v0.12, others throughout. Unified spawn-per-call execution layer v0.9 #6343, unified file sync v0.9 #7087, bulk SSH/Modal sync via tar v0.9 #8014. |

**The Kanban domain is where I will spend the most time.** Two attempts in two releases, multiple in-flight fix PRs, and the "hallucination gate" suggests they have seen the agent itself lie about completing tasks — exactly the failure mode we will face.

## Cross-cutting practices Hermes uses I will adopt

Without these, the TypeScript implementation will quietly diverge from Hermes' battle-tested patterns:

1. **Atomic writes for every JSON state file** — temp file + rename. Not optional.
2. **File locks for every multi-process resource** — cron tick, kanban heartbeat. Document the lock per file.
3. **Profile-aware paths via a single getter** — `getTheokitHome()`, never `os.homedir() + ".theokit"`.
4. **Schema versioning with migration** — Hermes' `_config_version` is the model. Bumps trigger migration; new keys added to existing sections do not.
5. **Plugin contract via narrowly-typed lifecycle hooks** — not Python decorators, not duck typing. TypeScript interfaces with explicit method signatures.
6. **Auto-discovery + explicit wiring** — tools discovered automatically, but their *enablement* is a deliberate, named choice.
7. **Cache the system prompt; never alter context mid-conversation** — except for explicit `Agent.invalidateCache()`. Compression is the only exception.
8. **Default to opt-in for surveillance features** — redaction off until explicitly enabled (after the v0.12-v0.13 redaction round trip). Telemetry off until enabled. Memory storage off until enabled.
9. **Surface errors with provider + endpoint context** — generic "Ocorreu um erro" is banned. Hermes' v0.4 #2266 was the canonical fix.
10. **Test for invariants, not snapshots** — the change-detector ban applies to our TypeScript suite verbatim.

## Open questions to resolve before writing the v1.3 spec

These cannot be resolved by reading source alone — flagging for human review at the end of this deep-dive:

- **Kanban scope**: are we implementing the **full** worker lifecycle (heartbeat / reclaim / zombie / hallucination gate / auto-block) for v1.3, or a v1.0 "single-process board" first? Hermes shipped only the full version, but our use case may not need cross-process workers.
- **Cron `noAgent`**: do we require the spawned script to inherit the agent's environment (HERMES_HOME, provider creds, MCP server states), or is it an opaque shell-out? Hermes' implementation needs more reading.
- **Provider plugins migration**: do we keep hardcoded providers (OpenAI/Anthropic/Gemini/OpenRouter) AND ship the ABC, or migrate the four hardcoded ones to plugins in the same PR? Hermes shipped the ABC first, hardcoded providers second (v0.13 #20324 was the ABC, providers still being migrated in follow-up PRs).
- **Active Memory dialectic mode**: do we ship our own Honcho-like dialectic implementation, or wrap the Honcho library as an optional peer dep and expose `MemoryOptions.userModel: "dialectic"` as a setting that requires the peer? Hermes wraps Honcho; cleaner for us probably to wrap and not reimplement.
- **Execution backends — Singularity**: AGENTS.md tree mentions `singularity` (HPC container runtime) but I have not seen it called out in release notes. Need to verify it is *actually* implemented vs. listed.

## What the next 15 docs will cover

| Doc | Domain | Why I am writing it |
|---|---|---|
| `01-kanban.md` | Multi-agent Kanban | The hardest feature — distributed coordination via heartbeats, zombies, retry, hallucination gate. |
| `02-runUntil-goal.md` | `/goal` Ralph loop | Brand new in v0.13; smallest API surface but new design pattern for the SDK. |
| `03-autonomous-skills.md` | `Memory.proposeSkill` | The Curator and self-improvement loop are the precedent; we need to translate to an explicit SDK API. |
| `04-cross-session-fts5.md` | `Memory.searchAllSessions` | Mature SQLite usage; lowest engineering risk; highest reuse. |
| `05-dialectic-user-model.md` | Honcho integration | Decide wrap-vs-reimplement here. |
| `06-execution-backends.md` | 7 backends | Largest API surface; pick the right protocol abstraction first. |
| `07-provider-plugins.md` | `ProviderProfile` ABC | Backwards-incompat for v1.2 users? Plan migration. |
| `08-checkpoints-v2.md` | Checkpoint pruning + disk guardrails | `hermes_state.py` is 2966 LoC — deep mine. |
| `09-no-agent-cron.md` | `Cron.create({ noAgent })` | Smallest feature; verify it is really just script-only. |
| `10-state-persistence.md` | `~/.hermes/state/` layout overall | Cross-cutting prerequisite for kanban, checkpoints, skills. |
| `11-tool-registry.md` | 98 tools | Cross-cutting prerequisite for kanban tools, goal tool. |
| `12-plugin-loader.md` | Plugin discovery | Cross-cutting prerequisite for provider plugins, memory plugins. |
| `13-security-redaction.md` | Secret redaction | Cross-cutting prerequisite for checkpoints + autonomous skills. |
| `14-testing-strategy.md` | Test patterns | How Hermes tests 17k tests with 4 workers — adopt for our suite. |
| `99-implementation-guide.md` | Final synthesis | Dependency order, ADRs, TDD plan, timeline. |

Citation discipline reminder for the next 15 docs: **every architectural decision needs a `file.py:NNN` cite**, and the line must actually contain what I claim. I will verify with `sed -n 'NNNp' path/file.py` or `grep -n 'pattern' path/file.py` before writing.

## References

- `referencia/hermes-agent/README.md`
- `referencia/hermes-agent/AGENTS.md` (the development guide — lines 84-1080 are the substance)
- `referencia/hermes-agent/RELEASE_v0.2.0.md` through `RELEASE_v0.13.0.md` (12 files, ~5,400 lines total)
- Project `CLAUDE.md` rules in `theokit-sdk/CLAUDE.md` — reference is read-only
- Inviolable rules `theokit-sdk/.claude/rules/no-stubs-no-mocks-no-wired.md` and `real-llm-validation.md`
