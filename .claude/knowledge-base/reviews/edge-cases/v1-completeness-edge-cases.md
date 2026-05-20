# Edge Case Review — v1-completeness

Data: 2026-05-15
Tasks analisadas: 4 (T1.1, T2.1, T3.1, T4.1)
Edge cases encontrados: 6 (MUST FIX: 2, SHOULD TEST: 2, DOCUMENT: 2)

---

## MUST FIX

### EC-1: `Agent.resume` never calls `initialize()` — resumed agents are half-loaded

- **Task afetada:** T3.1 (resume-agent example) — but the root cause is in `packages/sdk/src/agent.ts:84-103`.
- **Família:** State / Boundary
- **Cenário:** `Agent.create()` does `const agent = new LocalAgent(options); await agent.initialize(); return agent;` (`agent.ts:208-210`). `Agent.resume()` returns `new LocalAgent({...mergedOptions, model})` directly — **no `initialize()` call**. `LocalAgent.initialize()` is what actually loads hooks (`HooksExecutor.initialize`), context (`FileContextManager.initialize`), skills (`SkillsManager.initialize`), plugins (`PluginsManager.initialize`), and subagents (`loadSubagents`). A resumed agent that had `context: { manager: "file" }`, `skills`, hooks, plugins, or subagents in its registered options will have NONE of them loaded — `agent.context.snapshot()` returns `{ sources: [] }`, `agent.skills.list()` returns `[]`, hooks never fire.
- **Impacto:** Silent feature regression. The `examples/resume-agent` example happens to dodge this (uses only sessions, which live in a process-wide map keyed by agentId — not on the agent instance), but ANY user copying the example and adding `skills` / `context` / hooks to their agent will observe the half-loaded behaviour with zero error message. Cron's internal use of `Agent.resume` at `internal/cron/run-job.ts:44` ALSO hits this — cron jobs with project-loaded skills/context don't see them.
- **Fix sugerido (1 line):** In `agent.ts:84`, change the function body to `const agent = new LocalAgent(...); await agent.initialize(); return agent;` in BOTH the "existing registered" branch AND the cold-resume branch (where no registry entry exists). Add to plan as new task T3.0 (before T3.1) plus a TDD test `resume_loads_hooks_skills_context_just_like_create`.

### EC-2: Double-write to memory file when fixture-mode key is paired with `Remember:`

- **Task afetada:** T1.1 (Memory auto-write)
- **Família:** State / Idempotency
- **Cenário:** After T1.1 wires `appendMemoryFact` into `LocalAgent.send` (step 3 of T1.1 Tasks), the call runs BEFORE `dispatchRun` — so it fires regardless of which runtime (fixture vs real) is selected. But `createFixtureRun` (`local-agent.ts:282-308`) ALSO still wires `persistMemoryFact` into `createLocalRun`, which the fixture's `memoryWriteScript.beforeComplete` invokes (`fixture-scripts.ts:56-59`). Result: a single `agent.send("Remember: foo")` against a fixture key writes the fact to disk **twice**, producing duplicate entries in the persisted JSON array.
- **Impacto:** Data corruption — every "Remember:" in fixture mode doubles the fact. Existing fixture-mode contract tests may or may not catch this depending on what they assert about the file contents.
- **Fix sugerido (3 lines in `local-agent.ts createFixtureRun`):** Stop passing `persistMemoryFact` to `createLocalRun` — the new shared persistence in `send()` covers both paths. Delete lines 285-293 (`const persistMemoryFact = ...`) plus the spread `...(persistMemoryFact !== undefined ? { persistMemoryFact } : {})`. Add to T1.1 Tasks as step 3.5 ("Remove redundant fixture-path persist wiring") plus a TDD test `localAgent_single_write_in_fixture_mode_when_pattern_matches` that asserts the file is written exactly once.

---

## SHOULD TEST

### EC-3: Empty fact after extraction — `"Remember: "` (trailing whitespace only)

- **Task afetada:** T1.1
- **Teste sugerido:** `localAgent_skips_persistence_when_extracted_fact_is_empty()` — send `"Remember:   "` with `memory.enabled=true`; assert the memory file is NOT written / not created. Today `extractMemoryFact` returns `""` for empty captures, and the plan's step 3 says "If matched, extract... Call appendMemoryFact" without an empty-check. Writing an empty `{ text: "" }` to the file pollutes recall with a useless empty bullet in the `<memory>` block. The TDD section already mentions "(extract returns '' — caller skips empty facts)" as an aside but no test enforces the skip.
- **Fix em 1 linha:** in `LocalAgent.send` after `const fact = extractMemoryFact(userText)`, guard `if (fact.length === 0) return;` before the safeCall.

### EC-4: `Remember:` matches but `memory.enabled !== true` — must skip persistence

- **Task afetada:** T1.1
- **Teste sugerido:** `localAgent_skips_persistence_when_memory_disabled()` — create agent WITHOUT `memory` (or with `memory: { enabled: false }`); send `"Remember: foo"`; assert no file is created under `.theokit/memory/`. The plan's step 3 currently reads "If `isMemoryWritePrompt` matches: extract... call safeCall(() => appendMemoryFact(this.workspaceCwd, this.options.memory!, { text: fact }), ...)". The `this.options.memory!` non-null assertion would crash at runtime when `memory` is undefined. The check `memoryConfig?.enabled === true` must gate the persistence call, mirroring the existing fixture-path guard at `local-agent.ts:286`.
- **Fix em 1 linha:** wrap the entire auto-write block in `if (this.options.memory?.enabled !== true) { skip }`. Single guard, identical pattern to existing memory-disabled path.

---

## DOCUMENT

### EC-5: `examples/provider-inspector` requires `THEOKIT_API_KEY` — silent crash otherwise

- **Task afetada:** T2.1
- **Risco aceito:** `Theokit.providers.list()` calls `executeCatalogRequest` which calls `resolveApiKey(options.apiKey)` — when no API key is set, it throws `AuthenticationError("Missing API key")`. The example would crash on its very first line before any output is printed. Plan's deep-dive notes "needs a `THEOKIT_API_KEY`" but the `.env.example` content isn't specified. Document explicitly in the plan: the new `.env.example` for `provider-inspector` MUST set `THEOKIT_API_KEY=theo_test_inspector` (fixture key — returns bundled `FIXTURE_PROVIDERS` catalog offline) PLUS the real provider key (OPENROUTER/OPENAI/ANTHROPIC) needed for `agent.providers.routes()` to be meaningful. Add the explicit `.env.example` content to the T2.1 Tasks list (one line) so the example is runnable as documented.

### EC-6: Concurrent `send()` calls on the same workspace can race the memory write

- **Task afetada:** T1.1 (limitação pré-existente, agora exposta ao real runtime)
- **Risco aceito:** `appendMemoryFact` does read-modify-write without locking (`memory-store.ts:55-58`): read existing facts → push new fact → writeFile. Two concurrent `send("Remember: ...")` calls can lose one fact (the second write overwrites the first). This is a pre-existing limitation on the fixture path; T1.1 simply opens a new vector to hit it (real-runtime users with parallel agents). Fix would be file-locking or atomic-append — both bigger than the auto-write feature warrants in v1. **Document in `examples/memory/README.md`:** "Memory writes are NOT concurrency-safe within v1 — avoid parallel `send()` calls that both persist facts on the same workspace, or use distinct `userId` / `namespace` values to isolate."

---

## Resumo

| Task | Edges encontrados | MUST FIX | SHOULD TEST | DOCUMENT |
|------|-------------------|----------|-------------|----------|
| T1.1 | 4 | 1 (EC-2) | 2 (EC-3, EC-4) | 1 (EC-6) |
| T2.1 | 1 | 0 | 0 | 1 (EC-5) |
| T3.1 | 1 | 1 (EC-1) | 0 | 0 |
| T4.1 | 0 | 0 | 0 | 0 |

**Veredicto:** PLANO PRECISA DE AJUSTE

EC-1 (`Agent.resume` missing `initialize()`) is a real wiring bug the resume example would either silently work around (sessions live elsewhere) or silently break for any user adding skills/context/hooks. The fix is one `await` and a regression test — add T3.0 BEFORE T3.1 so the example covers a correctly-initialized resumed agent.

EC-2 (double-write on fixture mode) is a clean data-corruption bug the new auto-write path introduces. The fix is removing 3 lines of now-redundant code from `createFixtureRun` — explicit step in T1.1.

EC-3 and EC-4 are 1-line guards plus 1 test each — absorb into T1.1's existing TDD list.

EC-5 and EC-6 are honest limitations resolvable by README/`.env.example` content — no code change.

Nenhum dos 6 edges justifica nova abstração, nova classe, nem retry/lock/coordination infra. Todos resolvem com `if` / await / nota em doc.
