---
slug: sota-tool-descriptions
created_at: 2026-06-26
goal: Upgrade the 9 built-in sdk-tools' default descriptions to SOTA ACI copy verified against each tool's real behavior, so consumers need no description override.
---

# Plan: SOTA default descriptions for the 9 built-in `@theokit/sdk-tools`

> **Version 1.0** — The 9 built-in tools (`read_file`/`write_file`/`edit_file`/`glob_files`/`search_text`/`shell_exec`/`todolist`/`web_fetch`/`web_search`) ship terse, mechanics-only `description` strings. A consumer (theocode) maintains a `TOOL_DESCRIPTIONS` map + `withSotaDescription` to OVERRIDE them with rich Agent-Computer-Interface (ACI) copy — an app-side reimplementation of what should be the framework default. Per the radar thesis ("if the framework's descriptions aren't good, evolve the framework, don't override app-side"), this plan promotes SOTA descriptions to the sdk-tools DEFAULTS. Each new description is GENERALIZED (no app-specific tool references) and VERIFIED against the tool's actual handler behavior (the description now lives next to the implementation it describes → it cannot drift). No `description?` override option is added — `withDescription` (existing ACI primitive) already covers the rare per-consumer override; the point is that the default is SOTA.

## Goal

> "Replace the 9 built-in sdk-tools' default `description` strings with SOTA, behavior-verified ACI copy so a consumer needs no override, measured by `pnpm --filter @theokit/sdk-tools test` passing with new per-tool description-content assertions (each tool's description asserts its key behavioral facts)."

## Context

The deep review of theocode (radar) found `server/tools/tool-descriptions.ts` is a 164-LoC `TOOL_DESCRIPTIONS` map + `withSotaDescription` that overrides the sdk-tools' terse defaults. The user's architectural call: the framework already owns the tool implementations, so it should own SOTA descriptions too — overriding app-side duplicates, risks drift (the override asserts behavior in a file separate from the code), and leaves every other consumer with terse defaults. The fix is framework-side: SOTA defaults. The ACI infra (`withDescription`, `renderToolList`) already exists in `sdk-tools/src/internal/tool-aci.ts`.

## Baseline Context (deep review of current state)

### Files that will be touched

| File | Current `description` (terse) | name | Verify-against (handler facts) |
|---|---|---|---|
| `packages/sdk-tools/src/read-file.ts` | "Read a single project-relative text file as UTF-8…" | read_file | inputSchema is `{ path }` only (no offset/range); refuses traversal/forbidden/binary/too_large(5MB); returns whole file |
| `packages/sdk-tools/src/write-file.ts` | "Write UTF-8 content… Creates parent directories…" | write_file | OVERWRITES; creates parent dirs; refuses traversal/forbidden/binary-overwrite |
| `packages/sdk-tools/src/edit-file.ts` | "Replace the first occurrence… whitespace-normalized fallback… .bak backup" | edit_file | FIRST match only; whitespace-normalized fallback; .bak backup; old≠new |
| `packages/sdk-tools/src/glob-files.ts` | "List project files matching a glob-like pattern…" | glob_files | `*`/`**` wildcards; excludes node_modules/.git/dist/.theo; relative paths |
| `packages/sdk-tools/src/search-text.ts` | "Search the project tree for a literal text query… up to ${maxMatches}…" | search_text | literal (VERIFY case-sensitivity in handler); skips sensitive/binary/>1MB; `{file,line,preview}`; `path` scope; keep `${maxMatches}` interpolation |
| `packages/sdk-tools/src/shell-exec.ts` | "Execute a shell command… Default timeout 30s, max 5 minutes…" | shell_exec | stdout/stderr/exit_code; 30s default / 5min max; 5MB cap; catastrophic-command guard |
| `packages/sdk-tools/src/todolist.ts` | "Track multi-step task progress. Actions: …" | todolist | actions add/complete/in_progress/remove/list/clear_completed; returns items+items_summary |
| `packages/sdk-tools/src/web-fetch.ts` | "Fetch content from a URL via HTTP/HTTPS… capped at 1 MB…" | web_fetch | http(s) only; 1MB cap; VERIFY redirect + private-host behavior (allowPrivateHosts default) before asserting SSRF copy |
| `packages/sdk-tools/src/web-search.ts` | "Search the web for a query…" | web_search | title/url/snippet; provider injected; maxResults default |
| `packages/sdk-tools/tests/*.test.ts` (9) | length>20 only | — | add per-tool description-content assertions |

### Current callers / dependents

- **Each `createXTool`** is consumed by any SDK user + theocode (`server/tools/index.ts`). Changing the default description string is backward-compatible (the description is LLM-facing prose, not an API signature). `docs.md` documents the tools' RETURN shapes + caps (`docs.md:2140-2148`), NOT the description prose — so the prose change does not violate the API contract.
- **ACI infra:** `withDescription(tool, desc)` + `renderToolList(tools)` (`src/internal/tool-aci.ts`) — unchanged; this plan only improves the defaults those compose over.
- **No test asserts verbatim description content** (Explore-verified across all 9) — only `read-file.test.ts:35` asserts `length > 20` (still true). New assertions are additive.

### Domain glossary

- **ACI (Agent-Computer Interface)** — the tool `description` the LLM reads to decide which tool to call and how; richer, behavior-accurate descriptions measurably improve tool-selection (Anthropic SWE-bench, OpenCode/Codex).
- **behavior-verified** — every claim in a new description is checked against the tool's actual handler (e.g. "first match only" is read from `edit-file.ts`), so description and code change together — no drift.
- **generalized** — the SOTA copy drops app-specific cross-tool references (e.g. "delegate to the explore tool") that don't belong in a framework default.

### Architecture boundaries affected

- None — `packages/sdk-tools/src/*` internal change to description strings + tests. No new export, no dependency, no API signature change. `docs.md` (source-of-truth for the public API) is unaffected (it documents return shapes, not description prose); a CHANGELOG entry records the default-copy upgrade.

## Prior Art & Related Work

- **In-repo ACI infra** — `sdk-tools/src/internal/tool-aci.ts` (`withDescription`/`renderToolList`) + `tool-aci.test.ts`; `docs.md:2037` "ACI — tool description override + render `<tools>`".
- **Consumer override being eliminated** — theocode `server/tools/tool-descriptions.ts` `TOOL_DESCRIPTIONS` (the SOTA copy this plan promotes, generalized + verified).
- **Field evidence** — Anthropic's published SWE-bench result attributes a large jump to tool-description refinement (cited in theocode's own file header).

## Objective

- [ ] Each of the 9 tools ships a SOTA default `description` — generalized (no app refs) + verified against its handler behavior.
- [ ] `search_text` case-sensitivity + `web_fetch` redirect/private-host claims are VERIFIED in the handler before being asserted in the description (no drift).
- [ ] `search_text` keeps its `${maxMatches}` interpolation; `todolist` keeps its action list accurate.
- [ ] Each tool's test asserts the description's KEY behavioral facts (not verbatim — assert the load-bearing phrases).
- [ ] `pnpm --filter @theokit/sdk-tools test` green; `pnpm --filter @theokit/sdk-tools typecheck` 0; biome clean; CHANGELOG + changeset added.

## Dependencies

### Existing — use as-is

| Package | Version | Ecosystem | Why |
|---|---|---|---|
| (none changed) | | | Description-string + test change only; no dependency added. |

### New — to be introduced

| Package | Version | Ecosystem | Rule 9 rationale | Why this one |
|---|---|---|---|---|
| (none) | | | | — |

### Removed

| Package | Last version | Why removed |
|---|---|---|
| (none) | | |

## ADRs

### D1 — Improve the DEFAULT description (not add a `description?` override)

- **Decision:** rewrite each `defineTool({ description })` default to SOTA copy; do NOT add a `description?` field to the `CreateXToolOptions`.
- **Rationale:** the thesis is "the framework default should be good", not "make it overridable" — overridability already exists via `withDescription` (the ACI primitive). A good default benefits every consumer with zero config; a per-factory `description?` would just re-open the override door this work is closing. KISS/YAGNI + Rule 9 (reuse `withDescription`, don't add a parallel knob).
- **Alternatives considered:** (a) Add `description?` to every options interface — REJECTED: re-introduces the override pattern; `withDescription` covers the rare case. (b) Leave defaults terse, ship a separate "SOTA descriptions" map in sdk-tools — REJECTED: a map separate from the implementation re-creates the drift risk; the description belongs inline next to the handler.
- **Consequences:** consumers (theocode) drop their override map entirely; the description lives next to the code it describes (no drift); `withDescription` remains for genuine per-consumer customization.

### D2 — Every claim is behavior-verified against the handler

- **Decision:** before asserting a behavioral fact (case-sensitivity, redirect-following, first-match), read the tool's handler and assert only what is true of THAT implementation; generalize away app-specific cross-references.
- **Rationale:** the whole point of moving descriptions into the framework is that description and behavior change together. A description copied verbatim from theocode (which describes its GUARDED web-fetch wrapper, not the sdk default) would lie. Honest ACI (Rule 3) > copied copy.
- **Alternatives considered:** (a) Copy theocode's strings verbatim — REJECTED: theocode's `web_fetch` copy describes its `createGuardedWebFetchTool` wrapper ("redirects NOT followed", SSRF) which is NOT the sdk `createWebFetchTool` default; copying it would assert false behavior. Each claim is verified per-tool.
- **Consequences:** `search_text`/`web_fetch` descriptions reflect the sdk default's REAL behavior (verified in implement), which may differ from theocode's wrapper-flavored copy — that's correct.

## Drawbacks & Risks

| Drawback / Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| A new description asserts behavior the handler doesn't have (drift at birth) | Medium | ADR D2: verify each claim against the handler in implement; the per-tool test asserts the load-bearing phrases | maintainer |
| Longer descriptions add prompt tokens for every consumer | Low | ACI richness is the documented win (tool-selection accuracy); consumers wanting terser can `withDescription` | maintainer |
| `search_text` `${maxMatches}` interpolation lost in the rewrite | Low | Keep the template literal; a test asserts the interpolated number appears | maintainer |

## Unresolved Questions

(none — every decision is resolved at plan time)

## Dependency Graph

```
Phase 1 (fs tools: read/write/edit/glob/search/shell — verify+rewrite+test) ──▶ Phase 2 (todolist + web_fetch + web_search — verify+rewrite+test)
                                                                                   │
                                                                                   ▼
                                                                          Final Phase: Integration Validation
```

## Phase 1: Filesystem + shell tools

**Objective:** SOTA default descriptions for `read_file`/`write_file`/`edit_file`/`glob_files`/`search_text`/`shell_exec`, each verified + tested.

### T1.1 — Rewrite + test the 6 fs/shell descriptions

#### Objective
For each of the 6 tools: read the handler, write a SOTA generalized description accurate to it, and add a test asserting its key behavioral phrases.

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — replaces 6 terse `description:` strings with SOTA copy; for `search_text` reads the handler to confirm case-sensitivity before asserting it; adds per-tool description-content assertions.
2. **Why it is necessary now** — these 6 are the core code-agent tools theocode overrides most; promoting them is the bulk of the thesis.

#### Evidence
The 6 current descriptions + the absence of verbatim tests (Explore map); `edit-file.ts` "whitespace-normalized fallback"; `read-file.ts` inputSchema `{ path }` only.

#### Files to edit
```
packages/sdk-tools/src/{read-file,write-file,edit-file,glob-files,search-text,shell-exec}.ts — SOTA default description
packages/sdk-tools/tests/{read-file,write-file,edit-file,glob-files,search-text,shell-exec}.test.ts — description-content assertions
```

#### Deep file dependency analysis
- Each file: change only the `description:` string in `defineTool({...})`. `search-text.ts` keeps the `${maxMatches}` template. No handler/logic change. Tests add `expect(tool.description).toContain('<key phrase>')` for the load-bearing facts.

#### Deep Dives
- **Verify (search_text):** read the handler's matching code; assert "case-sensitive" ONLY if the implementation is case-sensitive; otherwise describe the real behavior.
- **Generalize:** drop "delegate to the explore tool" / "use shell_exec with rg" cross-refs; keep tool-intrinsic guidance ("read before you edit", "first match only — include enough context to be unique").
- **TDD:** write the description-content test FIRST (RED — current terse string lacks the phrase), then rewrite the description (GREEN).

#### Pseudo-code / Signatures
```ts
// edit-file.ts
description:
  "Make an exact string replacement in a project-relative file. Replaces the FIRST occurrence " +
  "of old_string (a whitespace-normalized fallback is attempted if the exact match fails) and " +
  "writes a .bak backup first. Read the file first so old_string matches exactly; include enough " +
  "surrounding context to be unique (only the first match is replaced). old_string must be non-empty " +
  "and differ from new_string. Returns { ok, replacements } or { ok: false, error }.",
// edit-file.test.ts
expect(tool.description).toContain("FIRST occurrence")
```

#### Tasks
1. For each of the 6: write the RED description-content test.
2. Verify handler behavior (esp. search_text case-sensitivity); rewrite the description (GREEN).
3. Run the 6 test files + typecheck.

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] 6 test files green: `pnpm --filter @theokit/sdk-tools test`
- [ ] Types compile: `pnpm --filter @theokit/sdk-tools typecheck`
- [ ] Biome clean: `pnpm --filter @theokit/sdk-tools lint`
- [ ] search_text case-sensitivity is read from the handler before the claim is written: `grep -nE "toLowerCase|toLocaleLowerCase|/i" packages/sdk-tools/src/search-text.ts` — the description's case claim matches the grep result
- [ ] Each of the 6 descriptions asserts a load-bearing phrase: `grep -c "toContain" packages/sdk-tools/tests/edit-file.test.ts` returns `>= 1`
- [ ] search_text keeps its match-cap interpolation: `grep -q "maxMatches" packages/sdk-tools/src/search-text.ts` exits 0

#### DoD (Definition of Done)
- [ ] All tasks completed and validated
- [ ] All tests passing — `pnpm --filter @theokit/sdk-tools test`
- [ ] Zero type errors — `pnpm --filter @theokit/sdk-tools typecheck`
- [ ] Biome clean
- [ ] No claim in a description is unverified against its handler

## Phase 2: todolist + web tools

**Objective:** SOTA default descriptions for `todolist`/`web_fetch`/`web_search`, verified + tested.

### T2.1 — Rewrite + test todolist + web descriptions

#### Objective
SOTA descriptions for the 3 remaining tools; `web_fetch`'s redirect/private-host claims VERIFIED against `web-fetch.ts` (not copied from theocode's guarded wrapper).

#### Why this step (action + reasoning — ReAct discipline)

1. **What this step does** — rewrites `todolist` (when-to-use guidance), `web_fetch` (verified http(s)/cap/redirect behavior), `web_search` (provider-injected, maxResults) defaults + tests.
2. **Why it is necessary now** — completes the 9-tool set; `web_fetch` needs careful verification (theocode's copy describes a wrapper, not the sdk default).

#### Evidence
`web-fetch.ts` Options (`allowPrivateHosts?`, `defaultTimeoutMs?`); the 3 current terse descriptions; theocode's `web_fetch` copy describes the GUARDED wrapper (must NOT be copied verbatim — ADR D2).

#### Files to edit
```
packages/sdk-tools/src/{todolist,web-fetch,web-search}.ts — SOTA default description
packages/sdk-tools/tests/{todolist,web-fetch,web-search}.test.ts — description-content assertions
```

#### Deep file dependency analysis
- `todolist.ts` returns a `TodolistTool` (not `CustomTool`) — change only its `description`. `web-fetch.ts`: read the handler to confirm whether it follows redirects + how `allowPrivateHosts` defaults BEFORE writing the SSRF/redirect copy. `web-search.ts`: provider-injected, returns title/url/snippet.

#### Deep Dives
- **Verify (web_fetch):** does the sdk default follow redirects? what is the private-host default? Describe ONLY the real behavior (ADR D2). If the sdk default DOES follow redirects (unlike theocode's guard), the description says so — honest.
- **todolist:** generalize the when-to-use / when-not-to-use guidance (3+ steps, single state, one in_progress).

#### Pseudo-code / Signatures
```ts
// web-fetch.ts — write ONLY what the handler does (verified), e.g.:
description:
  "Fetch the contents of a URL over HTTP/HTTPS. Rejects non-http(s) URLs; the body is size-capped (1 MB). " +
  "<redirect + private-host behavior described per the verified handler>. Use only for URLs the user " +
  "provided or that clearly help the task; never invent URLs. Returns { ok, content, status_code } or { ok: false, error }.",
expect(tool.description).toContain("HTTP/HTTPS")
```

#### Tasks
1. Write RED description-content tests for the 3.
2. Verify web_fetch handler behavior; rewrite the 3 descriptions (GREEN).
3. Run the 3 test files + full sdk-tools suite.

#### Concurrency tests

(none — single-threaded)

#### Acceptance Criteria
- [ ] 3 test files green: `pnpm --filter @theokit/sdk-tools test`
- [ ] web_fetch redirect/private-host behavior is read from the handler first: `grep -nE "redirect|allowPrivateHosts|location" packages/sdk-tools/src/web-fetch.ts` — the description's claim matches the grep result
- [ ] Types compile: `pnpm --filter @theokit/sdk-tools typecheck`
- [ ] Biome clean: `pnpm --filter @theokit/sdk-tools lint`
- [ ] todolist description lists its actions: `grep -q "clear_completed" packages/sdk-tools/src/todolist.ts` exits 0

#### DoD (Definition of Done)
- [ ] All tasks completed and validated
- [ ] All tests passing — `pnpm --filter @theokit/sdk-tools test`
- [ ] Zero type errors — `pnpm --filter @theokit/sdk-tools typecheck`
- [ ] Biome clean
- [ ] No claim unverified against its handler

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| G1 | 6 fs/shell tools have terse defaults | T1.1 | SOTA verified descriptions + tests |
| G2 | todolist + 2 web tools have terse defaults | T2.1 | SOTA verified descriptions + tests |
| G3 | descriptions must not drift from behavior | T1.1, T2.1 | ADR D2 — each claim verified against the handler |
| G4 | no app-specific cross-refs in a framework default | T1.1, T2.1 | generalized (drop "explore tool" etc.) |
| G5 | no override knob re-introduced | T1.1, T2.1 | ADR D1 — improve default, not add `description?` |
| G6 | no regression | T1.1, T2.1 | full suite + typecheck + biome green after both tasks |

**Coverage: 6/6 gaps covered (100%)**

## Global Definition of Done

- [ ] All phases completed
- [ ] All tests passing — `pnpm --filter @theokit/sdk-tools test`
- [ ] Zero type errors — `pnpm --filter @theokit/sdk-tools typecheck`
- [ ] Biome clean — `pnpm --filter @theokit/sdk-tools lint`
- [ ] CHANGELOG.md (`packages/sdk-tools/CHANGELOG.md`) + changeset added (minor bump)
- [ ] Every description claim verified against its handler (ADR D2)
- [ ] No `description?` override field added (ADR D1)
- [ ] **Plan archived** — after `/review` READY_TO_MERGE AND PR merged

## Failure scenarios (when I/O external)

```
(none — description-string + test change; no new I/O. web_fetch/web_search handlers are unchanged.)
```

## Final Phase: Integration Validation (MANDATORY)

> Runs AFTER Phases 1-2. The plan is NOT done until this chain passes.

### Execution
```
pnpm --filter @theokit/sdk-tools test
pnpm --filter @theokit/sdk-tools typecheck
pnpm --filter @theokit/sdk-tools lint
```

### Acceptance Criteria
- [ ] Full sdk-tools suite green: `pnpm --filter @theokit/sdk-tools test`
- [ ] Zero type errors: `pnpm --filter @theokit/sdk-tools typecheck`
- [ ] Biome clean: `pnpm --filter @theokit/sdk-tools lint`
- [ ] All 9 descriptions carry a content assertion: `grep -rc "toContain" packages/sdk-tools/tests/` shows the 9 tool test files each `>= 1`
- [ ] changeset present: `ls .changeset/*.md` lists the new entry

### If Validation Fails
1. Identify plan-caused vs pre-existing failures.
2. Fix all plan-caused failures before declaring complete.
3. Re-run the chain.
4. Log pre-existing issues in the PR description.
