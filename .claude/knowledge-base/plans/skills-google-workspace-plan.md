# Plan: `@usetheo/skills-google-workspace` (T3, Roadmap v1.4 #5)

> **Version 1.2 (PIVOT)** — Ship a single workspace package that consumes **one combined Google Workspace MCP server** (`google-workspace-mcp@2.3.6` by pm990320 — MIT, MIT-licensed, GitHub Actions OIDC trusted publisher) covering Calendar + Drive + Sheets + Docs + Gmail + Slides + Forms. Our value-add: a Node factory that emits an `McpServerConfig` ready to spread into `Agent.create({ mcpServers })`, a `theokit setup gworkspace` CLI that shells out to the upstream `npx google-workspace-mcp setup / accounts add` flow (with our EC-1 guard layered on top), and a cookbook with six real-LLM-validated recipes. **NÃO reinventa MCP** — we delegate to a battle-tested upstream server.
>
> **v1.1 → v1.2 pivot (see `.claude/knowledge-base/reviews/gworkspace-mcp-inventory.md`):**
> - Phase 0 inspection ruled out the per-product plan: the official `@modelcontextprotocol/server-gdrive` is 16 months stale; the combined `google-workspace-mcp@2.3.6` is recent, MIT, broadly maintained, ships its own CLI for OAuth + accounts management, and exposes a `--read-only` flag that satisfies the secure-default requirement.
> - **D341 reworded:** factory emits ONE `Record<string, McpServerConfig>` keyed by `gworkspace` (or `gworkspace-<account>` for multi-account).
> - **D342 reworded:** stdio launch via `npx google-workspace-mcp serve [--read-only] [--account <name>]`.
> - **D343 reworded:** read-only scope default enforced via `--read-only` flag at serve time, NOT scope narrowing (upstream uses one broad consent screen). Write opt-in toggles the flag off.
> - **D344 reworded:** credentials at `~/.google-mcp/credentials.json` per upstream convention (not `$THEOKIT_HOME/gworkspace/`). Less code, fewer paths.
> - **D345 reworded:** OAuth fully delegated to upstream `accounts add` command, which auto-opens browser and handles consent.
> - **Phase 3 simplifies massively** — our `theokit setup gworkspace` becomes a thin SDK-branded wrapper that shell-execs the upstream CLI.
>
> **v1.1 edge-case findings carried into v1.2** (see `.claude/knowledge-base/reviews/skills-google-workspace-edge-cases.md`):
> - **EC-1 (MUST FIX):** Wrong-type OAuth credentials (Web vs Desktop) — still our responsibility; upstream doesn't validate this. Implemented in our wrapper before shelling out.
> - **EC-2 (SHOULD TEST):** Malformed `credentials.json` — same wrapper.
> - **EC-3 (SHOULD TEST):** Probe timeout — now `npx google-workspace-mcp status` + `accounts test-permissions` with 10s timeout.
> - **EC-4 (SHOULD TEST):** Recipe 6 catches write rejection with scope-upgrade hint — adapted to surface "re-run `theokit setup gworkspace --writable`".
> - **EC-5 (SHOULD TEST):** Factory dedup of duplicate products — moot in v1.2 (single server); replaced by **EC-5b: factory rejects empty `products` and dedups account names**.
> - **EC-6 to EC-10 (DOCUMENT):** Windows chmod, key collision, tool collision, first-run OAuth, batch process count — captured in READMEs. EC-10 mitigated naturally (1 process vs 3).

## Context

**Where v1.4 stands.** Items #1 (Docs site), #2 (gateway-whatsapp), #3 (gateway-teams), #4 (gateway-email) are shipped (CLAUDE.md lines 593–597). Item #5 is the last open work in this roadmap.

**Why now.** Google Workspace is the most-requested productivity layer for chat agents — "agendar reunião, criar planilha, ler doc" is the canonical demo. We have all the runtime pieces in place:

- **MCP machinery** at `packages/sdk/src/internal/mcp/{client,oauth,token-storage}.ts` already speaks stdio + http and runs OAuth 2.1 PKCE (ADR D41) — proven in production by the Notion example.
- **MCP config surface** at `packages/sdk/src/types/mcp.ts` exposes `McpServerConfig` (stdio/http) to `Agent.create({ mcpServers })`.
- **CLI subcommand pattern** at `packages/cli/src/main.ts` + `packages/cli/src/commands/*.ts` is the template for `theokit setup`.
- **Workspace-package conventions** are established (gateway-* and memory-* packages all follow the same shape).

**What's missing.** A single, opinionated entry point for Google Workspace. Today a user has to:

1. Find an MCP server for each Google product (Calendar, Drive, Sheets) and pick one.
2. Hand-roll a Google Cloud project + OAuth Desktop client + `credentials.json` download.
3. Wire the three servers into `Agent.create({ mcpServers })` manually with the right paths and scopes.
4. Discover the right tool names, prompt patterns, and scope opt-ins from each server's README.

This is friction we can eliminate.

**MCP server choices (Phase 0 finding).** Pre-flight Phase 0 picks the three servers; current shortlist:

- **Calendar:** [`@cocal/google-calendar-mcp`](https://github.com/nspady/google-calendar-mcp) (MIT, active 2025, npm)
- **Drive:** [`@modelcontextprotocol/server-gdrive`](https://github.com/modelcontextprotocol/servers/tree/main/src/gdrive) (official Anthropic, MIT, npm)
- **Sheets:** [`@xing5/mcp-google-sheets`](https://github.com/xing5/mcp-google-sheets) (MIT, npm)

Combined alternatives (`@taylorwilsdon/google_workspace_mcp`) exist but Phase 0 task confirms the per-product picks because they evolve independently and each has cleaner scopes.

**Evidence.** CLAUDE.md Adoption Roadmap v1.4 explicitly scopes this item: "pacote ÚNICO empacotando 3 MCP servers (Calendar + Drive + Sheets) + OAuth setup helper + cookbook recipes. NÃO reinventa MCP — usa os servers oficiais ... com glue de credenciais e UX." This plan executes that mandate.

## Objective

**Done means:** a user runs `pnpm add @usetheo/skills-google-workspace`, then `npx theokit setup gworkspace`, then `Agent.create({ mcpServers: googleWorkspace({ products: ["calendar", "drive", "sheets"] }) })`, and their agent can answer "what's on my calendar tomorrow?" against a real Google account with **read-only scopes by default**.

Specific, measurable goals:

1. New workspace package `@usetheo/skills-google-workspace@0.1.0` published-ready (publint + attw clean, ESM+CJS+DTS).
2. `googleWorkspace(opts): Record<string, McpServerConfig>` factory exported from the package — returns one entry per requested product, ready to spread into `Agent.create({ mcpServers })`.
3. `theokit setup gworkspace` CLI subcommand walks user through Google Cloud project setup, stages `credentials.json` at `~/.theokit/gworkspace/credentials.json` with `chmod 600`, and runs a connectivity probe.
4. Read-only scope defaults wired per product; write scopes require explicit opt-in (e.g., `{ products: { calendar: { writable: true } } }`).
5. Six cookbook recipes in `examples/skills-google-workspace/` — `recipe-01-list-events.ts` through `recipe-06-combined-meeting-doc.ts` — env-gated, real-LLM-validated per `.claude/rules/real-llm-validation.md`.
6. theo-opendocs gets `content/theokit-sdk/concepts/skills-google-workspace.mdx` + auto-generated cookbook recipe.
7. CLAUDE.md Roadmap v1.4 #5 → ✅ DONE.
8. SDK regression sanity: gateway core 44/44 + SDK 1585/1585 + telegram-pro dogfood 44/44 PASS.

## ADRs

| ID | Decision | Rationale | Consequences |
|---|---|---|---|
| **D340** | `@usetheo/skills-google-workspace` ships as a separate workspace package, not a sub-export of `@usetheo/sdk`. | Matches the per-domain workspace-package policy already proven for gateway-* (D170/D171) and memory-* (D143). Lets users opt in to the ~5MB peer-dep footprint of three MCP servers without paying it for SDK-only agents. | Adds one workspace member. Versioning is independent — `0.1.0` per D181 pre-1.0 policy. |
| **D341** | The package exposes a single factory `googleWorkspace(opts): Record<string, McpServerConfig>` instead of three independent factories. | One factory per Workspace product would scatter the OAuth + credentials story across three call sites. A single factory keeps credential resolution in one place and matches the user's mental model ("I want Google Workspace, not three separate things"). | Users wanting only one product still call the same factory with `products: ["calendar"]`. Slightly more boilerplate than 3 individual factories, but ONE invariant ("creds resolved once") rather than three. |
| **D342** | MCP servers are launched via **stdio** transport (not HTTP/SSE). | All three chosen MCP servers ship as npm CLI packages that consume `credentials.json` from disk and speak stdio. HTTP would require us to host them. Stdio matches the existing Notion + filesystem MCP pattern proven in the SDK. | Users need Node 22+ installed (already required by SDK engines field). MCP servers spawned per-agent — `Agent.create()` triggers cold start (~200–500ms each); cached subsequent calls. |
| **D343** | Read-only OAuth scopes are the default; write requires explicit opt-in via `writable: true` per product. | Principle of least privilege. A bot that needs to "summarize my last week of meetings" should not be able to delete events. Matches the `.claude/rules/no-stubs-no-mocks-no-wired.md` discipline of safe-by-default APIs. | Onboarding flow shows one consent screen; if the user later wants write access they re-run `theokit setup gworkspace --writable=calendar,sheets` to grant additional scopes (re-consent in Google). |
| **D344** | Credentials live at `$THEOKIT_HOME/gworkspace/credentials.json` (default `~/.theokit/gworkspace/credentials.json`) with `chmod 600`. | Reuses the existing `getTheokitHome(cwd)` resolver (D60). Mirrors the MCP token storage pattern (D41 + `token-storage.ts`). Single canonical path that the package and all three MCP servers consume via `GOOGLE_APPLICATION_CREDENTIALS` env var. | Cross-process safety enforced via O_EXCL on initial write (D82). Re-running setup overwrites with backup at `credentials.json.bak.<timestamp>`. |
| **D345** | OAuth is delegated to each MCP server's own implementation, not unified at the SDK layer. | Each MCP server already handles its own OAuth flow against Google. Unifying would mean re-implementing the flow three times to match each server's expected token shape, which fights the "não reinventa MCP" rule. Our `theokit setup gworkspace` stages the shared `credentials.json` — the actual OAuth dance happens at first MCP server use. | Trade-off: first agent run shows ONE consent screen per product the first time. This is honest — it's what Google requires. The `theokit setup gworkspace --probe` flag warms each server to surface OAuth prompts up-front in the terminal instead of mid-agent-loop. |
| **D346** | `theokit setup gworkspace` lives in `packages/cli/src/commands/setup.ts` as a NEW top-level CLI subcommand `setup`, with `gworkspace` as the first concrete domain. | `setup` as a verb is reserved future-proofing — `setup notion`, `setup linear` follow the same pattern. Keeping it under `theokit` (vs. shipping `@usetheo/skills-google-workspace/cli`) keeps install-friction at zero (no extra bin). | Adds one subcommand to `commander` wiring in `main.ts`. CLI bundle grows by ~3KB. |
| **D347** | The cookbook ships at `examples/skills-google-workspace/` with **six** recipes, the LAST of which (`recipe-06-combined-meeting-doc.ts`) chains Calendar (read) → Drive (write to a Doc), demonstrating cross-product composition. | Five recipes feel like a list; six lets us showcase one *combined* scenario which is the package's actual value-add over running three servers independently. Per `.claude/rules/real-llm-validation.md` each recipe is env-gated; without creds they skip honestly. | Recipe 6 requires `writable: true` on Drive — the cookbook README walks the user through enabling it. |
| **D348** | Package version starts at `0.1.0` per D181 pre-1.0 policy; SDK + gateway versions unaffected. | This is purely additive; no changes to existing public APIs. The package can iterate independently. | Future breaking changes (e.g., adding Gmail) allowed within 0.x. |

## Dependency Graph

```
Phase 0: MCP server inventory + selection (research, no code)
   │
   ▼
Phase 1: Workspace package skeleton + types
   │
   ├──▶ Phase 2: googleWorkspace() factory + scope resolver
   │       │
   │       └──▶ Phase 5: Cookbook (parallel with Phase 4 once factory is stable)
   │
   ├──▶ Phase 3: CLI `theokit setup gworkspace`
   │       │
   │       └──▶ (independent — depends only on Phase 1)
   │
   └──▶ Phase 4: Docs site (gateways.mdx-style page + auto-generated cookbook)
           │
           └──▶ Phase 6: Dogfood QA + commit/push
```

- **Phase 0** is research-only (no code) — picks the three MCP servers.
- **Phase 1** is the only sequential blocker; everything else parallelizes after it.
- **Phase 6 (dogfood)** runs LAST per the project rule.

---

## Phase 0: MCP server inventory + selection

**Objective:** Lock the three MCP servers we'll consume. Research-only; no code change.

### T0.1 — Audit candidate MCP servers and lock the three

#### Objective
Produce a short report at `.claude/knowledge-base/reviews/gworkspace-mcp-inventory.md` listing candidates per product and the chosen one with rationale.

#### Evidence
Multiple MCP servers exist for each Google product. We must NOT pick blindly — adopting an unmaintained server creates support burden. Adoption metrics to inspect:
- Last release date (< 6 months per global CLAUDE.md §9 criteria)
- npm downloads / stars (signal, not gospel)
- License (MIT/Apache 2.0 acceptable per §9)
- Number of unresolved issues
- Whether OAuth is handled by the server or requires manual token wrangling

#### Files to edit
```
.claude/knowledge-base/reviews/gworkspace-mcp-inventory.md (NEW) — inventory report
.claude/knowledge-base/plans/skills-google-workspace-plan.md — update Context section with locked choices if Phase 0 picks differ from shortlist
```

#### Deep file dependency analysis
- `gworkspace-mcp-inventory.md` is a leaf doc; only this plan references it.
- The plan's Context section currently lists a *shortlist* — Phase 0 may update it.

#### Deep Dives
**Per-product candidates to evaluate:**

| Product | Candidates |
|---|---|
| Calendar | `@cocal/google-calendar-mcp`, `@taylorwilsdon/google_workspace_mcp` (combined) |
| Drive | `@modelcontextprotocol/server-gdrive` (official), `@taylorwilsdon/google_workspace_mcp` |
| Sheets | `@xing5/mcp-google-sheets`, `@taylorwilsdon/google_workspace_mcp`, `@google/sheets-mcp` (if exists) |

**Decision matrix per product:**

```
Maintenance signal (0–3) | License (Y/N) | Scope discipline (0–3) | Tool coverage (0–3) | Total
```

Reject any candidate scoring <6/9 or with non-permissive license.

#### Tasks
1. `npm view <candidate>` for each (last published, license, weekly downloads).
2. Read each candidate's README + scope handling.
3. Score in the matrix.
4. Pick one per product. If a combined server wins all three columns, pivot the plan to use it (Phase 1 absorbs the change).
5. Commit the inventory report.

#### TDD
No code in this task. TDD does not apply.

```
VERIFY: report exists and locks three choices with rationale; plan Context section updated if needed.
```

#### Acceptance Criteria
- [ ] Inventory report saved with date and per-product matrix
- [ ] Three servers locked (one per product OR one combined)
- [ ] Each chosen server is MIT/Apache 2.0 and released in the last 6 months
- [ ] Pass: report has ≥1 paragraph of rationale per choice

#### DoD
- [ ] Report committed
- [ ] Plan Context updated if shortlist changed

---

## Phase 1: Workspace package skeleton

**Objective:** Bootstrap `packages/skills-google-workspace/` mirroring the gateway-* layout, including build, types, tests, and CHANGELOG.

### T1.1 — Create the workspace package

#### Objective
A new pnpm workspace member that builds ESM+CJS+DTS, typechecks clean, passes publint + attw, and exports an empty placeholder `googleWorkspace()` that returns `{}`.

#### Evidence
Every recently-shipped per-domain package (gateway-email/teams/whatsapp/slack, memory-*) starts with this exact skeleton. Reproducing it minimizes review surface for the substantive change.

#### Files to edit
```
packages/skills-google-workspace/package.json (NEW)
packages/skills-google-workspace/tsconfig.json (NEW)
packages/skills-google-workspace/tsup.config.ts (NEW)
packages/skills-google-workspace/vitest.config.ts (NEW)
packages/skills-google-workspace/CHANGELOG.md (NEW)
packages/skills-google-workspace/LICENSE (NEW) — copy from packages/sdk/LICENSE
packages/skills-google-workspace/README.md (NEW)
packages/skills-google-workspace/src/index.ts (NEW) — placeholder export
packages/skills-google-workspace/src/types.ts (NEW) — public option types + sentinel marker
packages/skills-google-workspace/tests/placeholder.test.ts (NEW)
pnpm-workspace.yaml — add packages/skills-google-workspace
```

#### Deep file dependency analysis
- `package.json`: peer deps on `@usetheo/sdk` (workspace:^). NO peer deps on MCP servers themselves — those are spawned as child processes via `npx` or pinned via `cliCommand` option (resolved in Phase 2).
- `tsup.config.ts` mirrors gateway-email — dual ESM+CJS+DTS, `sideEffects: false`.
- `tsconfig.json` extends `../../tsconfig.base.json` (workspace shared).
- `pnpm-workspace.yaml`: adding a glob entry is the only repo-level edit.

#### Deep Dives
**Sentinel marker pattern** (per gateway-email/teams precedent): `src/types.ts` exports `export const __gworkspaceTypesMarker: unique symbol = Symbol("gworkspace-types");` to defeat the rollup-plugin-dts deep type-only re-export bug — without this, downstream consumers see empty `.d.ts`.

**Placeholder `googleWorkspace()` signature** in `src/index.ts`:
```typescript
export function googleWorkspace(opts?: GoogleWorkspaceOptions): Record<string, never> {
  void opts;
  return {};
}
```
Returns `Record<string, never>` so TypeScript narrows correctly when spread into `Agent.create({ mcpServers })`. Phase 2 widens this to `Record<string, McpServerConfig>`.

#### Tasks
1. `mkdir packages/skills-google-workspace/{src,tests}`
2. Add the package to `pnpm-workspace.yaml`.
3. Write `package.json` (peer dep on `@usetheo/sdk`, scripts: build/test/typecheck).
4. Copy `tsup.config.ts`, `tsconfig.json`, `vitest.config.ts` from gateway-email and adjust paths.
5. `cp packages/sdk/LICENSE packages/skills-google-workspace/LICENSE`
6. Write `src/index.ts` placeholder and `src/types.ts` with `GoogleWorkspaceOptions` interface (initially `{ products?: ReadonlyArray<"calendar" | "drive" | "sheets"> }`).
7. Write `tests/placeholder.test.ts` (calls `googleWorkspace()`, expects `{}`).
8. `pnpm install` from repo root to register the workspace.
9. Build + test + publint + attw to confirm green skeleton.

#### TDD
```
RED:     test_googleWorkspace_no_args_returns_empty_record — fails because src/index.ts doesn't exist yet
RED:     test_googleWorkspace_with_products_returns_empty_record_in_phase_1 — fails for same reason
GREEN:   Implement the placeholder factory
REFACTOR: None expected
VERIFY:  pnpm --filter @usetheo/skills-google-workspace test && pnpm --filter @usetheo/skills-google-workspace build
```

#### Acceptance Criteria
- [ ] Package builds CJS+ESM+DTS without errors
- [ ] 2 placeholder tests pass
- [ ] `publint` clean
- [ ] `attw` 100% green (node10 + node16-cjs + node16-esm + bundler)
- [ ] Pass: file sizes ≤ 100 lines each (skeleton stays minimal)
- [ ] Pass: zero biome warnings (`pnpm exec biome check packages/skills-google-workspace`)

#### DoD
- [ ] All tasks completed
- [ ] `pnpm --filter @usetheo/skills-google-workspace build` green
- [ ] `pnpm --filter @usetheo/skills-google-workspace test` green (2/2)
- [ ] `npx publint packages/skills-google-workspace` clean
- [ ] `npx @arethetypeswrong/cli --pack packages/skills-google-workspace` 100% green

---

## Phase 2: `googleWorkspace()` factory + scope resolver

**Objective:** The factory now returns real `McpServerConfig` entries for the chosen products, with read-only scope defaults and an opt-in `writable` per product.

### T2.1 — Implement the per-product config generators

#### Objective
Three internal builders — `buildCalendarConfig`, `buildDriveConfig`, `buildSheetsConfig` — each producing a valid `McpStdioServerConfig` for the chosen MCP server, with scopes resolved from the user's `writable` flag.

#### Evidence
The shortlist in Phase 0 fixes the three packages we'll spawn. Each has its own arg pattern, env-var contract, and scope syntax — encapsulating in a builder lets us swap servers later (if a chosen server is deprecated) without breaking the factory contract.

#### Files to edit
```
packages/skills-google-workspace/src/calendar.ts (NEW) — buildCalendarConfig
packages/skills-google-workspace/src/drive.ts (NEW) — buildDriveConfig
packages/skills-google-workspace/src/sheets.ts (NEW) — buildSheetsConfig
packages/skills-google-workspace/src/index.ts — replace placeholder with real factory
packages/skills-google-workspace/src/types.ts — extend GoogleWorkspaceOptions with product-specific opts
packages/skills-google-workspace/tests/calendar.test.ts (NEW)
packages/skills-google-workspace/tests/drive.test.ts (NEW)
packages/skills-google-workspace/tests/sheets.test.ts (NEW)
packages/skills-google-workspace/tests/factory.test.ts (NEW)
```

#### Deep file dependency analysis
- Each builder consumes resolved `GOOGLE_APPLICATION_CREDENTIALS` path (defaults to `~/.theokit/gworkspace/credentials.json`).
- `index.ts` orchestrates: enumerate user-requested products → call corresponding builder → assemble `Record<string, McpStdioServerConfig>` keyed by `gworkspace-calendar`, `gworkspace-drive`, `gworkspace-sheets` (unique names so `Agent.create({ mcpServers })` does not collide with any other MCP server the user wires).
- Tests use `tmp_dir` fixtures to verify file-path resolution; no network calls.

#### Deep Dives

**`GoogleWorkspaceOptions` shape:**
```typescript
export type Product = "calendar" | "drive" | "sheets";

export interface ProductOptions {
  /** Default false (read-only scope). Opt-in to write/edit scope. */
  readonly writable?: boolean;
}

export interface GoogleWorkspaceOptions {
  /** Default ["calendar", "drive", "sheets"]. */
  readonly products?: ReadonlyArray<Product>;
  /** Override path to credentials.json. Default $THEOKIT_HOME/gworkspace/credentials.json */
  readonly credentialsPath?: string;
  /** Per-product overrides (e.g., writable). */
  readonly calendar?: ProductOptions;
  readonly drive?: ProductOptions;
  readonly sheets?: ProductOptions;
}
```

**Scope defaults (read-only):**
- Calendar: `https://www.googleapis.com/auth/calendar.readonly`
- Drive: `https://www.googleapis.com/auth/drive.readonly`
- Sheets: `https://www.googleapis.com/auth/spreadsheets.readonly`

**Scope when `writable: true`:**
- Calendar: `https://www.googleapis.com/auth/calendar`
- Drive: `https://www.googleapis.com/auth/drive.file` (per-file granted, safer than `drive`)
- Sheets: `https://www.googleapis.com/auth/spreadsheets`

**Invariants:**
- `googleWorkspace(undefined)` returns all three products with read-only defaults.
- `googleWorkspace({ products: [] })` returns `{}` (explicit empty — degenerate but valid).
- Each builder MUST set `command: "npx"` and `args: ["-y", "<pkg>@latest", ...flags]` so users get auto-updates without modifying their lockfile (matches the official Anthropic Notion-MCP wiring). **EC-1 (absorb pre-emptively):** users with offline-only environments can pin via `process.env.THEOKIT_GWORKSPACE_PIN=1` to force `args: ["<pkg>"]` and rely on pre-installed npm cache.

**Edge cases:**
- `credentialsPath` does not exist → factory does NOT throw at construction (lazy). MCP server itself reports the error at first tool call. Rationale: `Agent.create()` must remain side-effect-free per the SDK contract.
- Unknown product in `products` → throw `TypeError` at construction (fail-fast per global rule §1).

#### Tasks
1. Write each per-product builder; cover scope resolution + env-var threading.
2. Write factory that calls builders based on `products`.
3. Wire `__gworkspaceTypesMarker` re-exports in all new files (sentinel pattern).
4. Replace `tests/placeholder.test.ts` with the four real test files.
5. Re-build + re-typecheck.

#### TDD
```
RED:     test_calendar_default_readonly_scope — buildCalendarConfig() returns args containing "calendar.readonly"
RED:     test_calendar_writable_scope — { writable: true } returns args with "calendar" (full scope)
RED:     test_drive_default_readonly_scope — buildDriveConfig() returns args with "drive.readonly"
RED:     test_drive_writable_uses_drive_file_not_drive — { writable: true } uses drive.file (per-file)
RED:     test_sheets_default_readonly_scope
RED:     test_sheets_writable_scope
RED:     test_factory_default_all_products — googleWorkspace() returns keys for calendar/drive/sheets
RED:     test_factory_subset — { products: ["calendar"] } returns ONLY gworkspace-calendar key
RED:     test_factory_empty_products_returns_empty — { products: [] } returns {}
RED:     test_factory_unknown_product_throws_TypeError — { products: ["gmail"] } throws
RED:     test_factory_credentials_path_threaded — credentialsPath override appears in every spawned server's env
RED:     test_factory_unique_keys — keys are stable strings like "gworkspace-calendar"
RED:     test_factory_dedups_duplicate_products (EC-5) — { products: ["calendar", "calendar"] } returns ONE entry, not two. Implementation: Array.from(new Set(products)) before the loop.
GREEN:   Implement builders + factory
REFACTOR: Extract shared scope-flag formatting if duplication appears (likely yes)
VERIFY:  pnpm --filter @usetheo/skills-google-workspace test
```

#### Acceptance Criteria
- [ ] 13 unit tests pass (12 original + EC-5 dedup)
- [ ] Factory returns `Record<string, McpStdioServerConfig>` typed correctly
- [ ] Read-only is default; write requires explicit opt-in
- [ ] EC-5 absorbed: duplicate products silently deduped
- [ ] Pass: `/code-audit` complexity ≤ 10 per file
- [ ] Pass: `/code-audit` coverage ≥ 90% on src/ files
- [ ] Pass: `/code-audit` size ≤ 500 lines per file (likely <200)
- [ ] Pass: zero biome warnings

#### DoD
- [ ] All 12 tests green
- [ ] Typecheck clean (`pnpm --filter @usetheo/skills-google-workspace typecheck`)
- [ ] Build CJS+ESM+DTS verde
- [ ] publint + attw still 100% green after additions

---

### T2.2 — Public `index.ts` exports and README skeleton

#### Objective
Settle the public surface so downstream code (cookbook, docs) can import stable names.

#### Evidence
Phase 5 (cookbook) imports from this package. Locking the public names now prevents churn.

#### Files to edit
```
packages/skills-google-workspace/src/index.ts — finalize public exports
packages/skills-google-workspace/README.md — quickstart + scopes table + Troubleshooting placeholder
```

#### Deep file dependency analysis
- `index.ts` is the package barrel. Adding/removing exports here is a public API change.
- `README.md` is the user-facing front door; consumed by `theo-opendocs` cookbook generator in Phase 4.

#### Deep Dives
**Exports (final):**
```typescript
export { googleWorkspace } from "./factory.js";
export type {
  GoogleWorkspaceOptions,
  Product,
  ProductOptions,
} from "./types.js";
```

**README sections (skeleton, filled with real examples in Phase 5):**
1. Quickstart (3 commands: install, setup, use)
2. Scopes table (read-only vs writable, per product)
3. Configuration reference
4. Troubleshooting (placeholders to fill from Phase 5 dogfood)

#### Tasks
1. Pin exports.
2. Draft README skeleton.
3. Verify `import { googleWorkspace } from "@usetheo/skills-google-workspace"` works from a sibling workspace by adding a fake importer test (only typechecks; no runtime).

#### TDD
```
RED:     test_public_exports_have_stable_names — uses dynamic import + reflection to verify export keys
GREEN:   Pin exports
REFACTOR: None
VERIFY:  pnpm --filter @usetheo/skills-google-workspace test && pnpm typecheck
```

#### Acceptance Criteria
- [ ] Public exports locked
- [ ] README has all 4 sections (Troubleshooting can be a stub at this point)
- [ ] Cross-package import works (verified by typecheck of cookbook in Phase 5)
- [ ] Pass: file size ≤ 500 lines

#### DoD
- [ ] Test green
- [ ] README skeleton committed

---

## Phase 3: `theokit setup gworkspace` CLI command

**Objective:** Walk a user from a blank Google Cloud account to a working `credentials.json` and an optional `--probe` connectivity check.

### T3.1 — Add `setup` top-level subcommand and `gworkspace` domain

#### Objective
`theokit setup gworkspace` is dispatchable from the CLI and prints the walkthrough.

#### Evidence
The user's CLAUDE.md explicitly lists `theokit setup gworkspace` (line 610). The CLI currently has `init/dev/inspect/eval` (main.ts lines 38–81) — adding a fifth verb follows the same commander wiring.

#### Files to edit
```
packages/cli/src/main.ts — wire .command("setup <domain>")
packages/cli/src/commands/setup.ts (NEW) — dispatch on domain
packages/cli/src/setup/gworkspace.ts (NEW) — gworkspace-specific flow
packages/cli/tests/setup.test.ts (NEW) — happy-path + unknown-domain
packages/cli/package.json — bump if needed (likely no)
```

#### Deep file dependency analysis
- `main.ts` gains one `.command(...)` block — pattern matches the existing four.
- `setup.ts` is a thin dispatcher (switch on `domain`).
- `setup/gworkspace.ts` houses the walkthrough — keeping per-domain logic out of `commands/` keeps test surface clean.
- Tests use the same harness as `init.test.ts` (mock stdout/stderr).

#### Deep Dives
**Command shape:**
```bash
theokit setup gworkspace [--writable calendar,sheets] [--probe] [--credentials-path <path>] [--non-interactive]
```

**Walkthrough sequence (TTY mode):**
1. Greeting + scopes-by-default disclaimer.
2. Step 1: "Open https://console.cloud.google.com and create or select a project. Press Enter when done."
3. Step 2: "Enable these APIs for that project: Calendar, Drive, Sheets. Direct link prefilled: <printed URL>. Press Enter when done."
4. Step 3: "Create OAuth 2.0 Client (Desktop application). Download `credentials.json`. Save it to `~/.theokit/gworkspace/credentials.json` (we'll create the directory if needed)."
5. Step 4: Verify the file exists at the expected path; `chmod 600`.
6. Step 5 (optional, `--probe`): Spawn each chosen MCP server, send `initialize`, capture output, report.

**Non-interactive mode (`--non-interactive` or CI):**
- Skip prompts. Verify `credentials.json` exists at `credentialsPath` (default `$THEOKIT_HOME/gworkspace/credentials.json`).
- If missing, write a one-page report to stderr explaining how to obtain it and exit 2 (user error).
- If present, set `chmod 600` and exit 0.

**Edge cases:**
- `credentials.json` malformed (invalid JSON) → fail with parse error message pointing at the file. (**EC-2**)
- Path traversal in `--credentials-path` → reject via `sanitizeIdentifier`/`safePathJoin` (D79/D80).
- **EC-1 (MUST FIX) — wrong OAuth client type:** Google Cloud Console offers Web / Desktop / Service-account OAuth client types. Users who never set this up before click the first (Web). Resulting JSON has shape `{ web: {...} }` instead of `{ installed: {...} }`, and downstream MCP servers fail mid-agent-loop with cryptic errors. Detect at setup time by inspecting the parsed JSON: if `parsed.installed` is missing but `parsed.web` is present, throw `Error("This is a 'Web application' OAuth client. Re-create as 'Desktop application' in Google Cloud Console.")`. ~3 lines in `setup/gworkspace.ts`.
- **EC-3 — `--probe` hangs:** if an MCP server accepts the stdio connection but never responds to `initialize`, probe waits forever. Cap each server probe at 10s via `Promise.race([probe, timeoutPromise(10_000)])`. On timeout, print `server X did not respond to initialize within 10s` and continue with the next server (not fatal — probe is best-effort).

#### Tasks
1. Wire commander `.command("setup <domain>")` in `main.ts`.
2. Implement `commands/setup.ts` dispatcher.
3. Implement `setup/gworkspace.ts` walkthrough using `@clack/prompts` (already a CLI dep — see `init.ts`).
4. Add `--probe` mode that spawns each server and pings `initialize` **with a 10s timeout per server (EC-3)**.
5. **EC-1 check:** After JSON parse in setup, validate shape (`installed.client_id` must exist) and reject with actionable error if it looks like a Web client.
6. Test happy-path (file already exists) + unknown-domain + non-interactive missing-file + path traversal rejection + **malformed JSON (EC-2)** + **wrong OAuth type (EC-1)** + **probe timeout (EC-3)**.

#### TDD
```
RED:     test_setup_unknown_domain_exits_2 — `theokit setup notion` (or any unknown) returns exit 2
RED:     test_setup_gworkspace_non_interactive_missing_creds_exits_2 — missing file → exit 2 + helpful stderr
RED:     test_setup_gworkspace_non_interactive_existing_creds_exits_0 — file exists → chmod 600 + exit 0
RED:     test_setup_gworkspace_credentials_path_traversal_rejected — "../../../etc/passwd" → exit 2
RED:     test_setup_gworkspace_probe_reports_per_server — --probe surfaces one line per server
RED:     test_setup_gworkspace_malformed_credentials_exits_2_with_parse_error (EC-2) — write "{not valid json" → exit 2 + stderr mentions "parse error" + the file path
RED:     test_setup_gworkspace_web_oauth_client_rejected_with_actionable_message (EC-1) — write `{"web":{"client_id":"x"}}` → exit 2 + stderr mentions "Web application" + "Desktop application"
RED:     test_setup_gworkspace_probe_timeout_per_server_10s (EC-3) — fake MCP server that accepts but never responds → probe aborts after 10s, prints "did not respond to initialize within 10s", continues
GREEN:   Implement
REFACTOR: Likely extract a shared chmod helper if duplicated
VERIFY:  pnpm --filter @usetheo/cli test
```

#### Acceptance Criteria
- [ ] 8 tests pass (5 original + EC-1 + EC-2 + EC-3)
- [ ] CLI help shows `setup` as a verb
- [ ] Non-interactive mode usable from CI
- [ ] EC-1 absorbed: Web-type OAuth credentials rejected up-front with actionable message
- [ ] EC-2 absorbed: malformed JSON rejected with parse error
- [ ] EC-3 absorbed: probe times out at 10s per server (not fatal — continues)
- [ ] Pass: `/code-audit` complexity ≤ 10 (with biome-ignore comment where unavoidable, matching existing CLI patterns)
- [ ] Pass: `/code-audit` size ≤ 500 lines

#### DoD
- [ ] Tests green
- [ ] Help output reviewed for clarity
- [ ] CHANGELOG.md in `packages/cli/` updated

---

## Phase 4: theo-opendocs concept page + cookbook

**Objective:** Make Google Workspace discoverable in the docs site.

### T4.1 — Add concept page + regenerate cookbook

#### Objective
A new `concepts/skills-google-workspace.mdx` modeled after `concepts/gateways.mdx`, plus an auto-generated `cookbook/skills-google-workspace.mdx` (consumes `examples/skills-google-workspace/README.md` from Phase 5).

#### Evidence
The docs-drift gate fails if a new concept doesn't have a page. Email gateway followed this exact pattern (see commit `a60126a`).

#### Files to edit
```
../theo-opendocs/content/theokit-sdk/concepts/skills-google-workspace.mdx (NEW)
../theo-opendocs/content/theokit-sdk/concepts/meta.json — add new entry
../theo-opendocs/content/theokit-sdk/cookbook/skills-google-workspace.mdx (auto-generated by pnpm generate:sdk-cookbook)
../theo-opendocs/content/theokit-sdk/cookbook/index.mdx + meta.json — auto-updated
```

#### Deep file dependency analysis
- `concepts/meta.json` controls sidebar ordering — append entry under "Skills" section (creating section if absent).
- `cookbook/skills-google-workspace.mdx` is overwritten by the generator; do not hand-edit.

#### Deep Dives
**Concept page sections (mirror gateways.mdx structure):**
1. What it is (1 paragraph)
2. Quickstart code block (factory call + Agent.create)
3. Scopes table (read-only vs writable defaults per product)
4. CLI setup flow (`theokit setup gworkspace`)
5. Cookbook link
6. ADRs link

#### Tasks
1. Write `skills-google-workspace.mdx`.
2. Update `concepts/meta.json` to add the page (insert in proper section).
3. Run `pnpm --dir ../theo-opendocs generate:sdk-cookbook` (Node 22+ required).
4. Run `pnpm --dir ../theo-opendocs types:check` — must pass cleanly.

#### TDD
No TDD for prose docs. Replaced by:
```
VERIFY: pnpm --dir ../theo-opendocs types:check && grep -q "skills-google-workspace" ../theo-opendocs/content/theokit-sdk/cookbook/index.mdx
```

#### Acceptance Criteria
- [ ] Page renders (verified via types:check)
- [ ] Auto-generated cookbook entry present
- [ ] Sidebar (concepts/meta.json) lists the page
- [ ] No drift error from theo-opendocs CI script

#### DoD
- [ ] types:check clean
- [ ] Sidebar order reviewed

---

## Phase 5: Cookbook — 6 recipes under `examples/skills-google-workspace/`

**Objective:** Six runnable example files that demonstrate the product. The last one composes Calendar + Drive.

### T5.1 — Scaffold `examples/skills-google-workspace/` + envgate harness

#### Objective
Project files, env loader, and a common `lib/scope-gate.ts` so each recipe can announce "skipped — set X to run" without crashing.

#### Evidence
Existing examples (whatsapp-bot, teams-bot, email-bot) all follow this skeleton; reproducing minimizes surprise.

#### Files to edit
```
examples/skills-google-workspace/package.json (NEW)
examples/skills-google-workspace/tsconfig.json (NEW)
examples/skills-google-workspace/.env.example (NEW)
examples/skills-google-workspace/lib/scope-gate.ts (NEW) — env-gating helper
examples/skills-google-workspace/README.md (NEW)
```

#### Deep file dependency analysis
- `lib/scope-gate.ts` is shared by all six recipes; tests in the SDK don't depend on it.
- `package.json` adds `@usetheo/skills-google-workspace` + `@usetheo/sdk` as workspace file-deps + `tsx` + `zod` (already proven in other examples).

#### Deep Dives
**`scope-gate.ts`:**
```typescript
export function requireCreds(): { path: string } {
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "";
  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  if (path.length === 0 || apiKey.length === 0) {
    console.log("[gworkspace-recipe] skipped — set GOOGLE_APPLICATION_CREDENTIALS + OPENROUTER_API_KEY to run.");
    process.exit(0);
  }
  return { path };
}
```

#### Tasks
1. Write `package.json` with dev script `run-recipe` that takes a filename.
2. Write env-gating helper.
3. Write `README.md` with provider table + scope-by-default disclosure.

#### TDD
No tests for examples per established convention. Smoke comes from running each recipe in Phase 5.2.

```
VERIFY: tsc --noEmit on the examples dir passes via tools/typecheck-examples.sh
```

#### Acceptance Criteria
- [ ] `tools/typecheck-examples.sh` lists `skills-google-workspace` as ✅ pass
- [ ] `.env.example` documents every env var used
- [ ] README has Quickstart (3 commands)

#### DoD
- [ ] Typecheck-examples sweep clean for this example

---

### T5.2 — Write all six recipes + run real-LLM validation

#### Objective
Six standalone files. Each demonstrates one workflow against a real Google account (env-gated).

#### Evidence
CLAUDE.md mandate: "cookbook com 5-6 recipes (agendar reunião, criar planilha, ler doc, etc)". Six lets us showcase Recipe 6 as the cross-product combined demo (D347).

#### Files to edit
```
examples/skills-google-workspace/recipe-01-list-upcoming-events.ts (NEW)
examples/skills-google-workspace/recipe-02-search-drive.ts (NEW)
examples/skills-google-workspace/recipe-03-read-google-doc.ts (NEW)
examples/skills-google-workspace/recipe-04-read-sheet.ts (NEW)
examples/skills-google-workspace/recipe-05-create-event-writable.ts (NEW) — requires writable: calendar
examples/skills-google-workspace/recipe-06-combined-meeting-doc.ts (NEW) — Calendar (read) → Drive (write)
examples/skills-google-workspace/README.md — fill out per-recipe section
```

#### Deep file dependency analysis
- Each recipe is independent — no shared state at runtime.
- Recipe 6 imports the helper `scope-gate.ts` and additionally checks for `writable: true` consent.

#### Deep Dives
**Recipe 1 (`list-upcoming-events`):**
```typescript
const agent = await Agent.create({
  apiKey: process.env.OPENROUTER_API_KEY!,
  model: { id: "openai/gpt-4o-mini" },
  mcpServers: googleWorkspace({ products: ["calendar"] }),
  systemPrompt: "You are a concise calendar assistant. Reply in plain text.",
});
const run = await agent.send("What's on my calendar in the next 24 hours?");
const result = await run.wait();
console.log(result.result);
await agent.dispose();
```

**Recipe 6 (`combined-meeting-doc`):**
1. Asks the agent to find the next meeting in Calendar.
2. Drafts an agenda based on the meeting title.
3. Creates a new Google Doc with that agenda (Drive write — `drive.file` scope).
4. Prints the resulting Doc URL.

**Real-LLM validation per `.claude/rules/real-llm-validation.md`:**
Each recipe runs against `openai/gpt-4o-mini` via OpenRouter. Recipe outputs are captured to `.claude/knowledge-base/reviews/skills-google-workspace-recipes-<date>.md` for evidence.

**Edge cases:**
- Empty calendar → recipe 1 reports "no upcoming events" honestly (no LLM hallucination).
- **EC-4 — No Drive write scope:** recipe 6 wraps the Drive write in a try/catch. On `403 Forbidden` from the MCP tool result, prints `Drive write rejected — re-run 'theokit setup gworkspace --writable=drive' to grant scope` and exits 0 (graceful, not a crash). Adicionar também essa fala no README Troubleshooting.
- MCP server cold-start timeout (rare, ~500ms) → recipe waits; if exceeds 10s, prints diagnostic.

#### Tasks
1. Write each recipe (60–100 lines each).
2. Run each against a real Google account with the SDK's OpenRouter key.
3. Capture transcripts for the validation report.
4. Fill out README per-recipe sections with the actual output.

#### TDD
No automated tests (per established convention for examples).
```
VERIFY: each recipe runs end-to-end with creds, saves transcript to review folder, exits 0
```

#### Acceptance Criteria
- [ ] All 6 recipes typecheck via `tools/typecheck-examples.sh`
- [ ] Each recipe runs end-to-end with real creds OR honestly skips without
- [ ] Real-LLM validation report saved
- [ ] README per-recipe sections written from real outputs

#### DoD
- [ ] Six recipes committed
- [ ] Validation report committed
- [ ] README complete

---

## Phase 6: Dogfood QA + commit + push

**Objective:** Regression-check telegram-pro, commit both repos, push to main.

### T6.1 — Regression check + commit + push

#### Objective
SDK and gateway behavior unchanged; both repos pushed to main with the new package, CLI verb, and docs.

#### Evidence
Established release pattern from prior v1.4 items (commits `0cb644b`, `fe2fcac`, `47a346a`).

#### Files to edit
```
CLAUDE.md — mark Roadmap v1.4 #5 as ✅ DONE with the new ADR range
```

#### Deep file dependency analysis
- Only CLAUDE.md edits at this stage. All other code already landed in Phases 1–5.

#### Deep Dives
**Validation sequence:**
1. `pnpm --filter @usetheo/sdk test` — must be 1585/1585 PASS.
2. `pnpm --filter @usetheo/gateway test` — must be 44/44 PASS.
3. `pnpm --filter @usetheo/skills-google-workspace test` — must be 14+/14+ PASS (new tests).
4. `pnpm --filter @usetheo/cli test` — must be ≥ prior count + 5 (new setup tests) PASS.
5. `/dogfood` (telegram-pro via CDP) — 44/44 PASS expected.
6. Commit + push theokit-sdk.
7. Commit + push theo-opendocs.

#### Tasks
1. Run the full validation sequence above.
2. Update CLAUDE.md mark Roadmap v1.4 #5 ✅ DONE.
3. `git add` only the intended files; commit per project rule (no co-author per user preference).
4. `git push origin main` on both repos.

#### TDD
No new code; verification only.

```
VERIFY: all 6 validation steps green
```

#### Acceptance Criteria
- [ ] SDK 1585/1585 PASS
- [ ] Gateway 44/44 PASS
- [ ] skills-google-workspace tests all PASS
- [ ] CLI tests all PASS
- [ ] telegram-pro dogfood 44/44 PASS
- [ ] CLAUDE.md updated and committed
- [ ] Both repos pushed

#### DoD
- [ ] All validation steps recorded with timestamps
- [ ] `git log -1 --oneline` on both repos shows the new commit
- [ ] CI green (if applicable)

---

## Coverage Matrix

| # | Gap / Requirement (from CLAUDE.md line 598 + 610) | Task(s) | Resolution |
|---|---|---|---|
| 1 | Pacote ÚNICO empacotando 3 MCP servers | T0.1, T1.1, T2.1 | Workspace package + factory returning Record per chosen MCP server |
| 2 | Calendar MCP | T0.1, T2.1 | Phase 0 locks the server; `buildCalendarConfig` wires it |
| 3 | Drive MCP | T0.1, T2.1 | Same — `buildDriveConfig` |
| 4 | Sheets MCP | T0.1, T2.1 | Same — `buildSheetsConfig` |
| 5 | OAuth setup helper | T3.1 | `theokit setup gworkspace` walkthrough + creds staging |
| 6 | Cookbook recipes | T5.1, T5.2 | Six recipes under `examples/skills-google-workspace/` |
| 7 | NÃO reinventa MCP | D342, T2.1 | Stdio launch of existing servers; no protocol re-implementation |
| 8 | `theokit setup gworkspace` (CLI) | T3.1 | New `setup` verb wired into commander |
| 9 | Defaults seguros (read-only scopes) | D343, T2.1 | Read-only is default; `writable: true` is opt-in |
| 10 | Reusa MCP machinery (D54, D41 OAuth) | D342, D345 | MCP via existing `internal/mcp/client.ts`; OAuth delegated to server (D345) |
| 11 | ADR range D340-D348 | D340–D348 | 9 ADRs cover all decisions |
| 12 | Docs site page | T4.1 | `concepts/skills-google-workspace.mdx` + auto-cookbook |
| 13 | Real-LLM validation | T5.2 | Six recipes against real Google + OpenRouter |
| 14 | SDK regression sanity | T6.1 | telegram-pro 44/44 + SDK 1585/1585 + gateway 44/44 |
| 15 | publint + attw clean | T1.1 | Verified in Phase 1; re-verified after each phase |
| 16 | CHANGELOG | T1.1 + T6.1 | New CHANGELOG per package + CLI bump |

**Coverage: 16/16 gaps covered (100%)**

## Global Definition of Done

- [ ] All 6 phases completed
- [ ] All tests passing (skills-google-workspace, CLI, SDK, gateway)
- [ ] Zero biome warnings
- [ ] Backward compatibility preserved (no changes to existing public APIs)
- [ ] publint + attw 100% green on the new package
- [ ] All 9 ADRs (D340–D348) registered in `.claude/knowledge-base/adrs/`
- [ ] `theokit setup gworkspace` documented in CLI `--help`
- [ ] Six cookbook recipes + README + real-LLM validation report
- [ ] theo-opendocs `concepts/skills-google-workspace.mdx` + cookbook entry + types:check clean
- [ ] CLAUDE.md Roadmap v1.4 #5 marked ✅ DONE
- [ ] Both repos pushed to main (sem co-autoria per user preference)
- [ ] **SDK dogfood telegram-pro: 44/44 PASS (zero regression)**

## Final Phase: Dogfood QA (MANDATORY)

> Plan does not touch SDK runtime. Dogfood is **sanity** (no regression) + skills-google-workspace recipe-level smoke.

### Execution

1. SDK sanity: telegram-pro `/dogfood` via CDP — must remain 44/44 PASS.
2. Skills smoke: run all six recipes with real Google account creds. Without creds, recipes must skip honestly per `real-llm-validation.md`.

### Acceptance Criteria

- [ ] telegram-pro dogfood: 44/44 PASS (zero regression)
- [ ] Each recipe either PASSES with creds OR honestly skips
- [ ] Zero CRITICAL or HIGH issues introduced

### If Dogfood Fails

1. SDK regression → unexpected (no SDK changes). Investigate.
2. Recipe failure with creds → log against the chosen MCP server's behavior; consider swapping in Phase 0 redo.
3. Pre-existing issues documented, do not block.

---

## Documented Risks (from edge-case review)

These are conscious "accept and document" calls — not action items, but worth surfacing in the package README's Troubleshooting section so the failure mode and the mitigation are findable when users hit them.

- **EC-6 — Windows `chmod 600`:** Filesystems without POSIX permissions (Windows NTFS, FAT32, some FUSE mounts) cannot enforce the mode bits. Reuse the existing pattern from `internal/mcp/token-storage.ts`: try `chmod 600`, catch failure, emit a one-time warning. Not fatal.
- **EC-7 — Factory key collision:** Users with existing `mcpServers: { "gworkspace-calendar": ... }` will see their config overridden by `googleWorkspace()` via spread semantics. Mitigate by reserving the `gworkspace-*` prefix in the README and suggesting rename if conflict.
- **EC-8 — Tool-name collision across the 3 MCP servers:** Theoretically two chosen servers could expose a tool with the same name; SDK MCP machinery dedups with a warning. Phase 0 confirms the chosen servers do not collide. Document the assumption in D342 footnote.
- **EC-9 — First-run OAuth blocks waiting for browser consent:** Reinforce in the recipes README that users SHOULD run `theokit setup gworkspace --probe` before the first recipe so OAuth happens up-front in the terminal, not mid-recipe.
- **EC-10 — Child-process count grows with `Agent.batch` concurrency:** Each `Agent.create()` spawns 3 MCP servers; concurrency=10 → 30 processes ≈ 1.5GB RAM. Mention in Troubleshooting: "for batch workloads, prefer a single shared agent over per-prompt agents, or lower concurrency".
