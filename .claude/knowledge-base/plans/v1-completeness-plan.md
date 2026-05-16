# Plan: v1 Completeness — Memory Auto-Write + Provider Inspector Example + Resume Example

> **Version 1.0** — Close three remaining v1 gaps surfaced after the runtime-gaps fix: (1) `Memory auto-write-on-send` in the real LLM runtime (today only the fixture path persists "Remember: …" facts), (2) a standalone example for the provider routing inspector (`agent.providers.routes()` is wired but undocumented for users), and (3) a standalone example for `Agent.resume(agentId)` (used internally by Cron, never demonstrated). The plan ships ~30 LoC of runtime change, 3 new examples, and ~10 new tests — keeping the 176-test regression suite green.

## Context

After commit `2b7d89a` (runtime-gaps-fix) closed the 5 ⚠️ Partial entries, the system-status review surfaced three remaining items:

| Item | Today | Evidence |
| --- | --- | --- |
| Memory auto-write-on-send | Fixture-only (`fixture-scripts.ts:29 isMemoryWritePrompt`) | The runtime-gaps-fix Dogfood revealed agent-2 said "undefined" because agent-1's "Remember: …" never persisted in the real runtime. The example was patched to write directly to disk as a workaround. Plan ADR D5 explicitly deferred this to "future work". |
| `agent.providers.routes()` runtime inspector | API exists (`packages/sdk/src/types/providers.ts:65`), wired (`ProvidersManagerImpl`), tested at contract level — never demonstrated to users | Examples README "Not covered yet" section names this gap |
| `Agent.resume(agentId)` | API exists (`packages/sdk/src/agent.ts:84`), used internally by `internal/cron/run-job.ts:44`, never demonstrated standalone | Examples README "Not covered yet" section names this gap |

Memory auto-write is the only one that needs real code. The other two are wired-but-undemonstrated — examples alone close the gap.

## Objective

Three v1 surfaces are reachable AND demonstrated end-to-end: a user types `"Remember: <fact>"` and a future agent on the same workspace recalls it without any custom code; `agent.providers.routes()` has a runnable example; `Agent.resume(agentId)` has a runnable example.

**Measurable goals:**

1. The `examples/memory` flow that ran "Persist via direct disk write" in the runtime-gaps-fix dogfood can switch to the "agent-1 says 'Remember: X' → agent-2 recalls X" shape against real OpenRouter, with zero manual disk writes.
2. A new `examples/provider-inspector` runs against real OpenRouter, lists every provider known to the platform (`Theokit.providers.list()`), and inspects the per-agent routing decisions (`agent.providers.routes()`).
3. A new `examples/resume-agent` runs against real OpenRouter, captures `agentId`, calls `Agent.resume(agentId)`, and demonstrates that the resumed handle shares session history with the original.
4. All 176 pre-existing tests stay green. New tests added for memory auto-write only (no new tests for the 2 example-only phases beyond the example itself acting as a smoke test).
5. Quality gates G1-G10 stay green.

## ADRs

### D1 — Memory auto-write detects on the USER message, not the assistant response

**Decision:** When `agent.send(message)` runs with `memory: { enabled: true }`, the SDK inspects the **user message** for the `Remember:` pattern (same regex the fixture path uses today: `/^\s*Remember(?:\s+this\s+durable\s+preference)?\s*:\s*(.+)/i`). If matched, the SDK extracts the fact and calls `appendMemoryFact` **before** dispatching to the LLM. The LLM still runs and responds normally, but persistence is no longer LLM-dependent.

**Rationale:** Detecting on the assistant response would require the LLM to use a stable acknowledgment marker (e.g. "Remembered: …") — fragile, non-deterministic across providers, and prone to false positives ("I'll try to remember" / "Remember when you said…"). Detecting on the user message is deterministic, free, testable, and matches the fixture path's behaviour — `examples/memory` becomes a behaviour-equivalent demo across fixture and real runtime. Alternative: an explicit `agent.memory.persist(fact)` method — rejected for v1 because it forces every caller to special-case persistence; the implicit-on-`Remember:` flow is the smaller user surface.

**Consequences:** New ~10-LoC `extractMemoryFact(message)` helper reused by both the fixture path (which already does it inline) and the real path. The fixture-mode test that already exists (`fixture-scripts.ts memoryWriteScript`) keeps passing — its `beforeComplete` hook fires the same `persistMemoryFact` callback. The real runtime gains its own persistence call at the top of `LocalAgent.send`.

### D2 — User message persistence happens BEFORE the LLM call, not after

**Decision:** The fact is appended **before** `dispatchRun(message, …)` so even if the LLM call fails (network, rate-limit), the fact is already durable. The next `send()` recalls it via the `<memory>` block.

**Rationale:** Persistence-after would mean a failed `send()` silently drops the fact — surprising. The user typed "Remember:" — they expect that to stick regardless of whether the assistant acknowledged it. Alternative: persist on `Run.wait()` success — rejected for the same reason. Side effect to be aware of: if the user types "Remember:" twice with the same fact, two duplicate entries land in the memory file. Tracked as future deduplication work (out of scope here — `appendMemoryFact` is append-only by design).

**Consequences:** `appendMemoryFact` already uses `redactSecrets` (memory-store.ts:62) — token-shaped strings are stripped before persistence. That contract holds. Auto-write inherits the redaction.

### D3 — Example file structure mirrors existing 14 examples

**Decision:** Each new example is a self-contained pnpm package matching the existing layout: `examples/<name>/{package.json, .env.example, src/index.ts, README.md}` with `pnpm install --ignore-workspace && pnpm dev`.

**Rationale:** Consistency with the 14 existing examples — users already know the pattern. Alternative: a single `examples/advanced/index.ts` showcasing all three — rejected because mixing memory writes + provider routes + resume in one file dilutes the demonstration.

**Consequences:** Three new directories under `examples/`. Each adds itself to the `examples/README.md` inventory table.

### D4 — Resume example demonstrates the in-process flow, not cross-process

**Decision:** The example creates an agent, captures `agentId`, disposes the handle, calls `Agent.resume(agentId)` in the same process, and sends a follow-up. It documents (in the README + a code comment) that registry persistence across processes is **not** in v1 — the agent registry is in-memory (`internal/runtime/agent-registry.ts:31 const agents = new Map`).

**Rationale:** Cross-process resume requires persisting the registry to disk + handling concurrency — a v2-sized feature. The in-process flow IS the contract Cron relies on today (`internal/cron/run-job.ts:44`), so demonstrating it has real value. Alternative: ship cross-process resume now — rejected as scope creep.

**Consequences:** Resume example README has a clear "v1 limitation" callout. Cross-process resume is a future plan trigger.

### D6 — `Agent.resume` MUST call `initialize()` before returning

**Decision:** Fix the latent wiring bug in `agent.ts:84-103` where `Agent.resume()` returns `new LocalAgent(...)` without awaiting `agent.initialize()`. `Agent.create` does this correctly (`agent.ts:208-210`); `Agent.resume` must match. Same fix applies to the cold-resume branch (registry miss) so a resumed agent always exposes hooks, context, skills, plugins, and subagents identical to a freshly-created one.

**Rationale (per edge-case review EC-1):** Without `initialize()`, a resumed agent with `context: { manager: "file" }` or `skills` returns empty snapshots / lists silently. The resume example happens to dodge this (uses session messages, which live in a process-wide map), but any user copying the example and adding project-loaded resources observes invisible breakage. Cron's internal `Agent.resume` at `internal/cron/run-job.ts:44` hits the same issue. Alternative: leave the resume API "fast" by skipping initialize — rejected because the cost is one `await` and the correctness benefit is decisive.

**Consequences:** One-line fix in `Agent.resume`. A new TDD test guarantees parity between `Agent.create` and `Agent.resume` for the initialized surfaces. Backward compatible — callers that didn't depend on initialization see no behaviour change; callers that DID see the bug silently are now correct.

### D5 — Provider inspector example shows BOTH `Theokit.providers.list()` AND `agent.providers.routes()`

**Decision:** One example file exercises both surfaces side-by-side — the global catalog (every provider known to the platform with `setupSchema`) and the per-agent resolved routes (which provider is doing what for THIS agent).

**Rationale:** The two are complementary: `Theokit.providers.list()` answers "what providers exist?", `agent.providers.routes()` answers "what is my agent using?". Splitting them across two examples would force users to read both to understand the relationship. Alternative: only `routes()` (skip the catalog) — rejected because the catalog has its own value (setup hints, capability advertising) and the file is small enough to host both.

**Consequences:** One new example covers two API surfaces. The README explains the split clearly.

## Dependency Graph

```
Phase 1 (memory auto-write) ─────┐
                                 │
Phase 2 (provider inspector) ────┤
                                 ├──▶ Phase 4 (cross-validation) ──▶ Final Dogfood QA
Phase 3 (T3.0 resume fix → T3.1 ─┘
         example)
```

Phases 1-3 are **independent** and can be implemented in any order — they touch different code paths and don't share state. Within Phase 3, T3.1 (example) blocks on T3.0 (resume init fix) — the example must run against the fixed API. I order phases by perceived risk: Phase 1 carries the biggest runtime change; Phase 3 has a small runtime fix; Phase 2 is example-only.

---

## Phase 1: Memory auto-write-on-send in the real LLM runtime

**Objective:** A user typing `"Remember: <fact>"` persists the fact to `.theokit/memory/<scope>.json` before the LLM call, so any subsequent agent on the same workspace recalls it via the auto-injected `<memory>` block.

### T1.1 — Extract shared `extractMemoryFact(message)` helper + wire auto-write in `LocalAgent.send`

#### Objective
Lift the existing fixture-only fact-extraction regex into a shared helper, then call `appendMemoryFact` from `LocalAgent.send` when the user message matches AND `memory.enabled === true`.

#### Evidence
`packages/sdk/src/internal/runtime/fixture-scripts.ts:83-87 extractFact` already does the regex extraction inside the fixture path. The same regex is needed in the real path; today it doesn't run.

`packages/sdk/src/internal/runtime/local-agent.ts:285-293` constructs `persistMemoryFact` but **only** passes it into `createFixtureRun`. The real path (`createRealLocalRun`) never receives or invokes it.

The runtime-gaps-fix Dogfood revealed this: the original `examples/memory/src/index.ts` had agent-1 say "Remember: 8675309" against real OpenRouter, and the file was never written. The example was patched to call `writeFile` directly — that workaround is what this phase removes.

#### Files to edit
```
packages/sdk/src/internal/runtime/memory-store.ts — (MODIFY) export shared extractMemoryFact + isMemoryWritePrompt helpers (move from fixture-scripts)
packages/sdk/src/internal/runtime/fixture-scripts.ts — (MODIFY) import the shared helpers instead of defining locally
packages/sdk/src/internal/runtime/local-agent.ts — (MODIFY) call appendMemoryFact at the top of send() when user message matches
examples/memory/src/index.ts — (MODIFY) revert to the "agent-1 says Remember: → agent-2 recalls" flow; remove direct writeFile
examples/memory/README.md — (MODIFY) document the auto-write behaviour
```

#### Deep file dependency analysis
- `memory-store.ts`: today only persists/reads facts. Adding two pure functions (`isMemoryWritePrompt`, `extractMemoryFact`) keeps the module cohesive — both deal with memory facts. No downstream files import these symbols yet.
- `fixture-scripts.ts`: today has its own local `extractFact` (line 83) and `isMemoryWritePrompt` (line 29). Replace with imports from memory-store. Behaviour identical. Existing fixture tests stay green.
- `local-agent.ts send()`: today computes `memoryFacts` for the recall path. Adds one more step BEFORE dispatchRun: check the user text for the Remember pattern, extract, and `appendMemoryFact` (wrapped in safeCall per the EC-4 pattern from runtime-gaps-fix). Then re-read facts so the recall path picks up the just-written one.
- `examples/memory/src/index.ts`: today writes directly to `.theokit/memory/demo/agent-user-1.json`. Reverts to the "two agents, one workspace" flow that's more compelling.

#### Deep Dives
- **Regex contract:** The fixture path matches `/^\s*Remember(?:\s+this\s+durable\s+preference)?\s*:\s*(.+)$/i`. Same regex in the shared helper. Anchored at start-of-message — "Please remember…" or "Can you remember…" do NOT match. This is deliberate: implicit memory-write is risky (false positives). The user opts in by saying "Remember:".
- **Order of operations in send():** (1) read existing facts → (2) check if user text triggers write → (3) if yes, `appendMemoryFact` + re-read so the new fact is in `memoryFacts` for THIS send → (4) build assembly context → (5) dispatch. The new fact appears in the same send's `<memory>` block, so the LLM can acknowledge it naturally ("Got it, magic number is 8675309").
- **safeCall wrap:** `appendMemoryFact` writes to disk. A disk full / permission denied error must NOT crash `send()` — wrap in `safeCall(() => appendMemoryFact(...), undefined, "memory write")`. The user's run continues; the fact silently dropped (with stderr warning).
- **Fixture parity:** `isMemoryWritePrompt` and `extractMemoryFact` are imported from the same module by both fixture and real paths — guarantees identical detection behaviour. No drift.
- **Redaction inherited:** `appendMemoryFact` already calls `redactSecrets` (token-shaped strings stripped). Auto-write inherits the protection.

#### Tasks
1. Move `isMemoryWritePrompt` + `extractMemoryFact` from `fixture-scripts.ts` into `memory-store.ts` as exported functions.
2. Update `fixture-scripts.ts` to import them (delete local copies). Verify behaviour identical via existing fixture tests.
3. In `LocalAgent.send`, after `readMemoryForSend()` returns, check the user text. **Gate the entire auto-write block on `this.options.memory?.enabled === true` (EC-4) — otherwise skip.** If `isMemoryWritePrompt` matches AND memory is enabled:
   - Extract the fact via `extractMemoryFact`.
   - **Skip if the extracted fact is empty (EC-3):** `if (fact.length === 0) skip the write but continue the send normally`.
   - Call `safeCall(() => appendMemoryFact(this.workspaceCwd, memoryConfig, { text: fact }), undefined, "memory write")`.
   - Re-read facts so the assembly context contains the just-written fact.
4. **Remove redundant fixture-path persist wiring (EC-2):** In `local-agent.ts createFixtureRun`, delete the `const persistMemoryFact = ...` block (lines 285-293 today) plus the `...(persistMemoryFact !== undefined ? { persistMemoryFact } : {})` spread in the `createLocalRun` call. The new shared persistence in `send()` covers both fixture and real paths. The fixture script's `beforeComplete` hook becomes a no-op when `persistMemoryFact` is undefined (existing guard at `fixture-scripts.ts:57`).
5. Revert `examples/memory/src/index.ts` to the two-agent flow (no direct `writeFile`).
6. Update `examples/memory/README.md` — remove the "v1 scope: auto-persistence is out of scope" callout; replace with a description of the new behaviour. **Add a "concurrency note" (EC-6):** memory writes are read-modify-write at v1; concurrent `send()` calls that both persist facts on the same workspace can race — isolate via distinct `userId` / `namespace` or serialize the sends.
7. Update `packages/sdk/CHANGELOG.md` under `[Unreleased]` — note auto-write is now wired in the real runtime.

#### TDD
```
RED:     isMemoryWritePrompt_matches_canonical_form() — "Remember: foo" → true; "Please remember foo" → false; "Remember: " (empty fact) → still matches the prompt (extract returns "" — caller skips empty facts).
RED:     extractMemoryFact_strips_trailing_period() — "Remember: foo." → "foo". (preserves the fixture-path behaviour at fixture-scripts.ts:86)
RED:     localAgent_persists_remember_fact_on_real_send() — stub Anthropic; agent with memory.enabled=true; send("Remember: magic-number is 8675309."); assert the memory file on disk contains the fact AFTER the send completes.
RED:     localAgent_recalls_just_written_fact_within_same_send() — same setup; assert the captured Anthropic request body `system` contains "8675309" (proves re-read happened before assembly).
RED:     localAgent_skips_write_when_pattern_does_not_match() — send("What's the magic number?"); memory file unchanged.
RED:     localAgent_write_failure_does_not_crash_send() — make memory dir read-only; send("Remember: foo"); assert run completes finished AND stderr captured a warning.
RED:     localAgent_skips_persistence_when_extracted_fact_is_empty() — send("Remember:   "); assert no file written (EC-3).
RED:     localAgent_skips_persistence_when_memory_disabled() — agent without memory option; send("Remember: foo"); assert no file written + no crash from accessing this.options.memory! (EC-4).
RED:     localAgent_single_write_in_fixture_mode_when_pattern_matches() — theo_test_* key + memory.enabled; send("Remember: foo"); assert the persisted file contains EXACTLY ONE fact entry (proves EC-2 double-write is gone).
GREEN:   Implement steps 1-4 in T1.1 Tasks.
REFACTOR: Verify the fixture path still passes the existing memory contract test.
VERIFY:  pnpm --filter=@usetheo/sdk exec vitest run tests/golden/runtime/memory-auto-write.golden.test.ts
```

#### Acceptance Criteria
- [ ] 9 golden tests pass at `tests/golden/runtime/memory-auto-write.golden.test.ts` (6 original + EC-3/EC-4/EC-2 single-write).
- [ ] All 176 pre-existing tests still pass (including the fixture-mode memory contract test that uses the now-shared helpers).
- [ ] `examples/memory` against real OpenRouter: agent-1 says "Remember:" → agent-2 recalls without any manual `writeFile` in the example source.
- [ ] Pass: G1-G10 via `pnpm validate` exit 0.
- [ ] No regression in jscpd duplication (sharing the helper actually reduces duplication, not introduces it).

#### DoD
- [ ] `pnpm typecheck` exits 0.
- [ ] Real LLM smoke against OpenRouter prints the recalled fact through the auto-injected block.
- [ ] CHANGELOG entry under `[Unreleased]`.
- [ ] No edits to `appendMemoryFact` signature — call site change only.

---

## Phase 2: Provider inspector example

**Objective:** Ship a standalone example that exercises `Theokit.providers.list()` + `agent.providers.routes()` so users have a copy-paste starting point.

### T2.1 — Create `examples/provider-inspector`

#### Objective
A new self-contained example package that prints the platform's provider catalog AND the per-agent resolved routes for the same agent.

#### Evidence
`docs.md:191` documents `agent.providers.routes()` but `examples/README.md` "Not covered yet" section explicitly names this as a gap. The contract tests at `tests/contract/provider-routing.contract.test.ts:40` and golden tests at `tests/golden/platform-extensions.golden.test.ts:64` exercise the API — it works — but no example demonstrates it.

#### Files to edit
```
examples/provider-inspector/package.json — (NEW)
examples/provider-inspector/tsconfig.json — (NEW)
examples/provider-inspector/.env.example — (NEW)
examples/provider-inspector/.gitignore — (NEW)
examples/provider-inspector/src/index.ts — (NEW)
examples/provider-inspector/README.md — (NEW)
examples/README.md — (MODIFY) add "provider-inspector" row in the Real LLM table
```

#### Deep file dependency analysis
- New directory; mirrors the layout of `examples/quickstart` (smallest existing example).
- `examples/README.md`: append one row in the Real LLM inventory table.

#### Deep Dives
- **What the example prints:**
  1. `Theokit.providers.list()` — every provider known to the platform with `name`, `displayName`, `capabilities[]`, `isAvailable`, `setupSchema`.
  2. `agent.providers.routes()` — resolved `{ capability, provider, model, reason }[]` for an agent configured with `providers.routes: [{ capability: "chat", provider: "anthropic" }, { capability: "embedding", provider: "openai" }]`.
  3. A short explanation of how `reason` is computed (explicit-model-provider / explicit-route / first-available-plugin-provider).
- **API key requirement:** `Theokit.providers.list()` needs a `THEOKIT_API_KEY` (uses `executeCatalogRequest`). For a `theo_test_*` fixture key, the SDK serves the bundled `FIXTURE_PROVIDERS` catalog — works offline. With a real key + `THEOKIT_API_BASE_URL`, it hits `/v1/providers`. The example documents both modes.
- **`reason` field interpretation:** the example explicitly prints the reason next to each route so users see why a route was picked. This is the only way `routes()` differs from blindly trusting `providers.routes` config.

#### Tasks
1. Scaffold `examples/provider-inspector/{package.json, tsconfig.json, .env.example, .gitignore}` mirroring `examples/quickstart`. Add `"@usetheo/sdk": "file:../../packages/sdk"` dependency.
2. **`.env.example` MUST include both `THEOKIT_API_KEY=theo_test_inspector` (so `Theokit.providers.list()` resolves to the bundled fixture catalog without a real PaaS) AND the chosen real provider key (`OPENROUTER_API_KEY=` / `OPENAI_API_KEY=` / `ANTHROPIC_API_KEY=`)** — without `THEOKIT_API_KEY` the example crashes on its first line with `AuthenticationError` (per EC-5).
3. Write `src/index.ts` that creates an agent with `providers.routes` configured, calls `Theokit.providers.list()`, calls `agent.providers.routes()`, and prints both.
4. Write `README.md` with sections: What it shows / Run / Output sample / `reason` field reference. Document explicitly that the catalog call uses `THEOKIT_API_KEY` (fixture or real PaaS) and the routing call uses the standard provider env keys.
5. Append one row to `examples/README.md` Real LLM table.

#### TDD
```
RED:     none — example is a smoke-only demonstration. Treat the dogfood-phase live run as the test.
GREEN:   N/A.
REFACTOR: None expected.
VERIFY:  `cd examples/provider-inspector && pnpm install --ignore-workspace && pnpm dev` exits 0 and prints both lists.
```

#### Acceptance Criteria
- [ ] `pnpm dev` from `examples/provider-inspector` prints both the catalog and the per-agent resolved routes against a real provider key.
- [ ] README explains the difference between `Theokit.providers.list()` (global catalog) and `agent.providers.routes()` (per-agent inspection).
- [ ] `examples/README.md` lists "provider-inspector" as ✅ Full.

#### DoD
- [ ] The example follows the layout of the existing 14 examples (same files, same install dance).
- [ ] No new SDK code introduced.

---

## Phase 3: Resume API fix + standalone example

**Objective:** Fix the latent `Agent.resume` initialization bug, then ship a standalone example demonstrating conversation continuity across resume.

### T3.0 — Fix `Agent.resume` to call `initialize()` before returning

#### Objective
Resumed agents must expose the same surface as freshly-created ones (hooks, context, skills, plugins, subagents all loaded). Today they don't — `agent.ts:84-103` skips `initialize()`.

#### Evidence
Edge-case review EC-1. `agent.ts:208-210` shows `Agent.create` does `await agent.initialize()`; `Agent.resume` doesn't. Confirmed by reading both branches of `resume()` — neither awaits anything. Cron uses `Agent.resume` internally (`internal/cron/run-job.ts:44`); cron jobs with project-loaded resources inherit the silent breakage.

#### Files to edit
```
packages/sdk/src/agent.ts — (MODIFY) await initialize() in both branches of Agent.resume
packages/sdk/tests/golden/agent/agent-resume.golden.test.ts — (NEW) regression test asserting parity with Agent.create
```

#### Deep file dependency analysis
- `agent.ts Agent.resume`: today returns `new LocalAgent(...)` or `new CloudAgent(...)` directly. After the fix, both branches assign to a local variable, `await agent.initialize()` (LocalAgent only — CloudAgent doesn't have initialize since it has no file-based loaders), and return.
- New test exercises the local branch only — cloud agents have no initialize step.

#### Deep Dives
- **LocalAgent vs CloudAgent:** `CloudAgent` doesn't expose `initialize()` (it has no project-local resources). Apply the fix only to local branches.
- **Backward compat:** Callers that worked before see no behaviour change. Callers that were silently broken (hooks not firing on resumed agents, context empty after resume) now get correct behaviour. No deprecation needed.
- **One-line fix in each of two branches:** the existing-registry branch and the cold-resume branch (no registry entry).

#### Tasks
1. Refactor `Agent.resume` to assign to a local variable and `await agent.initialize()` for the LocalAgent case in both branches (existing registry + cold).
2. Cloud branch: keep as-is (`new CloudAgent(...)` directly).
3. Write the regression test below.

#### TDD
```
RED:     resume_loads_hooks_skills_context_just_like_create() — create agent with skills + context configured, capture agentId, dispose, resume(agentId); assert (resumed.skills.list()).length === (original.skills.list()).length AND (resumed.context.snapshot()).sources.length > 0 (matching the original).
RED:     resume_for_cold_agent_id_does_not_crash() — Agent.resume("agent-unknown-id"); assert returns SDKAgent without throwing (matches existing behaviour for cold resume).
GREEN:   Implement step 1 in T3.0 Tasks.
REFACTOR: None expected.
VERIFY:  pnpm --filter=@usetheo/sdk exec vitest run tests/golden/agent/agent-resume.golden.test.ts
```

#### Acceptance Criteria
- [ ] 2 golden tests pass.
- [ ] Existing tests still pass (incl. `internal/cron/run-job.ts` callers — Cron is now also correctly initialized on resume).
- [ ] Pass: G1-G10.

#### DoD
- [ ] `Agent.resume()` body has explicit `await agent.initialize()` for LocalAgent branches.
- [ ] Test file added.

### T3.1 — Create `examples/resume-agent`

#### Objective
A new self-contained example that proves `Agent.resume(agentId)` reattaches to an existing agent and continues the conversation.

#### Evidence
`docs.md:609-613` documents `Agent.resume(agentId)`. The Cron scheduler relies on it (`internal/cron/run-job.ts:44`). `examples/README.md` "Not covered yet" section explicitly names this as a gap.

#### Files to edit
```
examples/resume-agent/package.json — (NEW)
examples/resume-agent/tsconfig.json — (NEW)
examples/resume-agent/.env.example — (NEW)
examples/resume-agent/.gitignore — (NEW)
examples/resume-agent/src/index.ts — (NEW)
examples/resume-agent/README.md — (NEW)
examples/README.md — (MODIFY) add "resume-agent" row in the Real LLM table
```

#### Deep file dependency analysis
- New directory; mirrors `examples/quickstart`.
- `examples/README.md`: append one row.

#### Deep Dives
- **In-process flow:**
  1. Create agent → record `agentId`.
  2. `agent.send("My favourite test runner is Vitest.")` → wait → log assistant reply.
  3. Dispose the original handle (`agent.close()`).
  4. `Agent.resume(agentId)` → fresh handle, same registry entry.
  5. `resumed.send("What's my favourite test runner?")` → wait → assistant should mention Vitest (via session history in `agent-session.ts`).
- **What proves continuity:** session messages are kept in-process by `internal/runtime/agent-session.ts`. `Agent.resume` reuses the same registry entry, and `LocalAgent.send` reads `getSessionMessages(this.agentId)` — so the resumed handle sees the prior user message + assistant response. The example asserts this by asking a follow-up that depends on the prior turn.
- **v1 limitation callout:** the README documents that registry persistence across processes is NOT in v1. After `process.exit`, the registry is gone — `Agent.resume(agentId)` will return a placeholder handle (`LocalAgent` constructor doesn't crash, but session history is empty). Future work: persistent registry.

#### Tasks
1. Scaffold `examples/resume-agent/{package.json, tsconfig.json, .env.example, .gitignore}` mirroring `examples/quickstart`.
2. Write `src/index.ts` with the in-process flow described above. Include a clear `console.log` showing the agentId is the same across create and resume.
3. Write `README.md` with: What it shows / Run / Output sample / v1 limitation note about cross-process registry persistence.
4. Append one row to `examples/README.md`.

#### TDD
```
RED:     none — example is a smoke-only demonstration. Treat the dogfood-phase live run as the test.
GREEN:   N/A.
REFACTOR: None expected.
VERIFY:  `cd examples/resume-agent && pnpm install --ignore-workspace && pnpm dev` exits 0; the resumed agent's response mentions "Vitest".
```

#### Acceptance Criteria
- [ ] `pnpm dev` from `examples/resume-agent` prints the same `agentId` from both `Agent.create()` and `Agent.resume()`.
- [ ] The resumed agent's response to a follow-up question references prior session content.
- [ ] README contains the cross-process limitation callout.
- [ ] `examples/README.md` lists "resume-agent" as ✅ Full.

#### DoD
- [ ] The example follows the layout of the existing 14 examples.
- [ ] No new SDK code introduced.

---

## Phase 4: Cross-validation report

### T4.1 — Generate cross-validation report

#### Objective
Verify Phase 1 wiring landed correctly and Phases 2-3 examples actually demonstrate the wired API. Compare against references where applicable.

#### Files to edit
```
.claude/knowledge-base/reviews/cross-validation/v1-completeness-xval-<DATE>.md — (NEW)
```

#### Tasks
1. Open each reference cited in ADRs and verify implementation matches.
2. Classify divergences per BLOCKER / CRITICAL / MAJOR / MINOR / INFO.
3. Save report under `.claude/knowledge-base/reviews/cross-validation/`.

#### TDD
N/A — review phase.

#### Acceptance Criteria
- [ ] Report saved with zero BLOCKERs.
- [ ] All ADR claims cross-referenced against actual code.

#### DoD
- [ ] Report committed.

---

## Coverage Matrix

| # | Gap / Requirement | ADR | Task | Resolution |
|---|---|---|---|---|
| 1 | Memory auto-write not in real LLM runtime | D1, D2 | T1.1 | Detect on user message before LLM call; share helper with fixture path |
| 2 | Auto-write must not break on disk error | D2 | T1.1 | `safeCall` wrap on `appendMemoryFact` |
| 3 | Auto-write fact recallable in same send | D2 | T1.1 | Re-read facts after write before assembly |
| 4 | Fixture path keeps working | D1 | T1.1 | Shared helper; existing fixture tests stay green |
| 5 | Memory example demonstrates the full loop | D1 | T1.1 | Revert example to two-agent flow; remove manual `writeFile` |
| 6 | `agent.providers.routes()` undocumented for users | D5 | T2.1 | New example covering routes() + Theokit.providers.list() |
| 7 | `Theokit.providers.list()` undocumented for users | D5 | T2.1 | Same example |
| 8 | `Agent.resume(agentId)` undocumented for users | D4 | T3.1 | New example demonstrating in-process resume |
| 9 | Cross-process resume limitation must be honest | D4 | T3.1 | README v1-limitation callout |
| 10 | Examples follow existing layout convention | D3 | T2.1, T3.1 | Mirror `examples/quickstart` layout |
| 11 | examples/README.md inventory updated | — | T2.1, T3.1 | Two new rows |
| 12 | CHANGELOG entry for runtime change | — | T1.1 | Step 7 in T1.1 Tasks |
| 13 | Cross-validation against references | — | T4.1 | Phase 4 report |
| 14 | EC-1 (MUST FIX): `Agent.resume` missing `initialize()` | D6 | T3.0 | Add `await agent.initialize()` in both LocalAgent resume branches |
| 15 | EC-2 (MUST FIX): Double-write on fixture mode | D1 | T1.1 step 4 | Remove redundant `persistMemoryFact` wiring from `createFixtureRun` |
| 16 | EC-3 (SHOULD TEST): Empty fact skip | D1 | T1.1 step 3 + TDD | Guard `if (fact.length === 0) skip` + dedicated test |
| 17 | EC-4 (SHOULD TEST): memory.enabled gate | D1 | T1.1 step 3 + TDD | Top-level `if (memory?.enabled !== true)` guard + dedicated test |
| 18 | EC-5 (DOCUMENT): provider-inspector requires THEOKIT_API_KEY | D5 | T2.1 step 2 | `.env.example` includes both fixture THEOKIT_API_KEY and the provider key |
| 19 | EC-6 (DOCUMENT): Memory write concurrency limitation | D2 | T1.1 step 6 | Concurrency note in `examples/memory/README.md` |

**Coverage: 19/19 (100%)**

## Global Definition of Done

- [ ] All 4 phases completed (Phase 3 has T3.0 + T3.1).
- [ ] `pnpm typecheck` exits 0.
- [ ] All 176 pre-existing tests still pass.
- [ ] 9 new tests in T1.1 pass (6 original + EC-3 + EC-4 + EC-2 single-write).
- [ ] 2 new tests in T3.0 pass (resume parity with create + cold-resume no-crash).
- [ ] Zero Biome warnings.
- [ ] G1-G10 via `pnpm validate` exit 0.
- [ ] Three new examples (`memory` rewritten + `provider-inspector` + `resume-agent`) run live against real OpenRouter and print expected output.
- [ ] Cross-validation report saved with zero BLOCKERs.
- [ ] **Runtime-metric proof** — Phase 1 has a stub-server golden test that asserts the memory file on disk contains the persisted fact AFTER a real-runtime `send()` (not just types compile). EC-2 single-write test proves the fixture-mode double-write is gone.
- [ ] **Backward compatibility** — agents without `memory.enabled` behave identically; `Agent.resume` callers that DIDN'T depend on initialization see no change; `Agent.resume` callers that DID silently observe missing skills/context/hooks now get correct behaviour (the resume bug fix is monotone — strictly more correct, no regression vector); `Theokit.providers.list()` callers behave identically.

## Final Phase: Dogfood QA (MANDATORY)

**Objective:** Validate every fix as a real user would experience it — run all 3 new/rewritten examples against the real OpenRouter key and confirm the documented expected output appears.

### Execution

```bash
cd examples/memory             && pnpm dev   # → agent-2 recalls 8675309
cd ../provider-inspector       && pnpm dev   # → prints catalog + routes
cd ../resume-agent             && pnpm dev   # → resumed agent mentions Vitest
```

### Acceptance Criteria

- [ ] `examples/memory` prints agent-2 recalling the fact via auto-write (no manual `writeFile` in source).
- [ ] `examples/provider-inspector` prints non-empty `Theokit.providers.list()` output AND non-empty `agent.providers.routes()` output.
- [ ] `examples/resume-agent` prints the resumed agent's reply referencing the prior turn.
- [ ] All 3 examples finish with `status=finished` (no `error`).

### If Dogfood Fails

1. Identify which example fails.
2. Phase 1 stub tests would have caught the wiring issue; if the live test fails for a different reason, distinguish "wiring bug" vs "LLM didn't cooperate".
3. Re-run the failing example after fix.
