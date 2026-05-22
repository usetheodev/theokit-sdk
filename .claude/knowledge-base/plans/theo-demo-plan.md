# Plan: `theo-demo` — Official SDK Demo App

> **Version 1.0** — Build the official `@usetheo/sdk` demo app as `apps/theo-demo/`,
> a fullstack TheoKit-framework app (Vite + React + server routes) that composes
> ~85 agent-purpose-built components from `@usetheo/ui` v0.1.0-next.0 to surface
> every SDK feature in one coherent product: real-LLM chat with streaming, memory
> recall, custom tools + MCP, personality presets, multi-provider toggle (Ollama
> local ↔ cloud), eval suite integration, and Theo PaaS deploy. Outcome: a
> developer who installs `npx @usetheo/cli init my-bot --template ollama-local`
> can instead clone `theo-demo`, run `pnpm dev`, and see EVERYTHING the SDK does
> in a single coherent UI — no `docs.md` reading required.

## Context

**What exists today (post-cleanup 2026-05-22):**

- 36 examples after 18-deletion pass (`chore(examples)` commit `ef1f6cb`).
- The surviving 36 are pedagogical — each demos ONE feature in 30-100 LOC of
  CLI script. Useful for docs-as-code, not as an "official demo."
- `telegram-pro` (1700+ LOC) is the de facto "kitchen sink" — but it requires
  Telegram setup + BotFather token + grammy + dogfood scripts; overwhelming
  for a first impression.
- `react-nextjs` exists as the "frontend reference" but Next.js is NOT the
  blessed stack — `theokit` framework is (per `theokit/README.md`: "Build the
  app your agent lives in. Routing, auth, real-time, deploy — wired.").
- `@usetheo/ui` v0.1.0-next.0 ships 85 agent-purpose components (chat-thread,
  agent-stream, tool-call-card, model-selector, memory-editor, etc.) —
  currently USED ONLY by `theokit/examples/deploy-vercel` and `theokit/fixtures/*`.
  Zero exposure inside `theokit-sdk` repo.

**What's broken / missing:**

- No single demo answers "show me what the SDK does." Discovery is
  fragmented across 36 scripts.
- No exposure of `@usetheo/ui` agent primitives inside SDK-side examples.
- No exposure of `theokit` (framework) inside SDK-side examples — the SDK
  + framework integration story is invisible.
- New developers can't see "what does an SDK-powered product look like?"

**Evidence:**

- Adoption Roadmap CLAUDE.md line 401: "A SDK não tem ponto de entrada
  além de `npm install`. Vercel AI e Mastra ganham 10x em onboarding por
  causa disso."
- The CLI (Roadmap #1, just shipped) gives `theokit init` as ONE entry
  point. This plan gives a DEPLOYABLE demo URL as the second — together
  they close the onboarding gap.
- `theokit/README.md` literally documents the 5-minute first-agent flow
  but no concrete consolidated demo lives in either repo.
- Sibling references — Mastra ships `mastra-playground`, OpenClaw ships
  visual capability-runner. Standard pattern for AI SDK adoption.

## Objective

**Done = clone `theokit-sdk`, `cd apps/theo-demo && pnpm install && pnpm dev`, open `http://localhost:3000`, and within 30 seconds the developer sees: streaming chat reply (real LLM), tool-call card surfaced inline, memory recall in the sidebar, personality dropdown switching the bot's voice mid-conversation, and provider toggle (Ollama ↔ cloud) with no restart.**

Specific measurable goals:

1. `apps/theo-demo/` ships as a Vite + React + TheoKit-framework app.
2. Composed from ~12-15 `@usetheo/ui` components (chat-thread, agent-streaming, tool-call-card, model-selector, memory-editor, command-palette, topnav, etc.).
3. Demonstrates 8 SDK surfaces in one coherent product (chat / memory / tools / personality / multi-provider / hooks D40 React / eval / telemetry hint).
4. Runs **100% locally** with Ollama (zero remote API key required) OR cloud (auto-detect via env).
5. Deployable to Vercel via `theokit` adapter (smoke test passes — same shape as `theokit/examples/deploy-vercel`).
6. `pnpm test` green, `pnpm typecheck` green, `pnpm exec theokit eval` (own bundled config) green.
7. Real-LLM dogfood: send "hello", get streaming reply, click tool button → tool executes, see memory update, switch personality → reply tone changes. All under 60s wall clock.
8. README is a guided tour, not a feature list.

## ADRs

- **D202 — `apps/theo-demo/` is a NEW top-level directory (not under `examples/`).**
  *Rationale:* The 36 surviving examples are 30-100-LOC pedagogical scripts (one feature per file, `tsx --env-file=.env src/index.ts` entry). `theo-demo` is an ~800-LOC fullstack deployable product — placing it in `examples/` violates the "each folder is a copy-pasteable snippet" expectation and confuses both audiences. `apps/` mirrors Mastra (`packages/cli` + `apps/playground` separation) and OpenClaw (`apps/openclaw.ai`).
  *Consequences:* enables clean expectation split (snippets in `examples/`, products in `apps/`); requires updating root `pnpm-workspace.yaml` glob to include `apps/*`.

- **D203 — Built on `theokit` framework (Vite + React + server routes), NOT Next.js.**
  *Rationale:* `theokit` IS the blessed app framework in the usetheo stack (per `theokit/README.md`). Using Next.js for the official SDK demo would (1) skip the framework story entirely, (2) duplicate the existing `react-nextjs` example, (3) miss the `theokit deploy` path. The sibling `theokit/examples/deploy-vercel/` (162 LOC for a static landing page) is the reference shape.
  *Consequences:* enables one-command deploy (`theokit deploy --target vercel`); SSR streaming for free (theokit `ssr: true`); requires `theokit ^latest` as dep (currently at 0.x, pre-1.0 — pinned and re-pinned on framework bumps).

- **D204 — UI composed from `@usetheo/ui` primitives, no bespoke components for surfaces the lib covers.**
  *Rationale:* `@usetheo/ui` v0.1.0-next.0 already ships 85 components specifically for agent UX — `chat-thread`, `agent-streaming`, `tool-call-card`, `model-selector`, `memory-editor`, `system-prompt-editor`, `command-palette`, etc. Rolling our own would (1) duplicate maintenance, (2) miss the lib's evolution, (3) make the demo look like every other Tailwind chat tutorial.
  *Consequences:* enables visual polish matching the locked `@usetheo/ui` design system without CSS work; constrains theme to TheoUI tokens (acceptable — they're already well-designed); pins demo to `@usetheo/ui` major.

- **D205 — Persistence is the SDK Memory layer (SQLite via `.theokit/memory/`), NOT a separate DB.**
  *Rationale:* The SDK Memory layer is itself the canonical persistence — using it dogfoods the contract. Adding Postgres/Prisma would (1) inflate the demo to enterprise-app dimensions, (2) hide the SDK's own storage story.
  *Consequences:* enables zero infra setup (works offline); ties demo lifecycle to SDK Memory schema; future Memory v2 migrations apply to the demo (via the existing `theokit-migrate-memory` CLI from `@usetheo/sdk/bin/`).

- **D206 — Provider toggle persisted via TheoKit settings (filesystem JSON on server + localStorage mirror on client).**
  *Rationale:* No auth in v1 (single-user demo). Settings live in `<cwd>/.theokit/demo-settings.json` server-side; the React UI mirrors via localStorage for instant reads. Server is authoritative on writes.
  *Consequences:* enables zero-friction toggle without DB; constrains demo to single-user (acceptable for v1; multi-user when TheoKit auth lands).

- **D207 — Personality switching uses `agent.usePersonality({ save: true })` per ADR D163.**
  *Rationale:* The SDK already ships personality presets (D160-D169). The demo simply consumes the contract — no parallel personality store. Switch persists via D163's `$THEOKIT_HOME/personality.json` mechanism.
  *Consequences:* enables "switch voice mid-conversation" UX without new abstractions; constrains personality store location (already locked by D163).

- **D208 — Demo ships 4 custom tools + 1 MCP server (filesystem).**
  *Rationale:* Tool catalog covers the 4 categories users actually need to see: deterministic (`get_current_time`), computational (`calculator`), retrieval (`search_memory`), and side-effect (`list_files` sandboxed via existing D80 path-guard). Adding more would dilute the demo; fewer would miss the "tools are not just one thing" story. MCP filesystem (via `@modelcontextprotocol/server-filesystem`) demonstrates the MCP path without external setup.
  *Consequences:* enables every viewer to see the tool-call lifecycle without setup; constrains tool count to the 4 chosen (adding a 5th in v1.1 OK; in v1 NO).

- **D209 — Eval suite runs as a child process spawning `@usetheo/cli`.**
  *Rationale:* The CLI's `eval` command (Roadmap #1, just shipped) is the canonical eval entry. Spawning it from the demo's `/api/eval/run` route reuses the contract — no duplication. Output (markdown report) is rendered inline in the UI.
  *Consequences:* enables consistent eval semantics across CLI and demo; constrains demo to require `@usetheo/cli` as workspace dep; report renders as markdown (handled by an MDX library or simple regex parser).

- **D210 — Demo surfaces 3 React hooks (D40) on 3 distinct routes.**
  *Rationale:* Per D40 (React hooks family — separate hooks), `useTheoChat`, `useTheoCompletion`, `useTheoAssistant<T>` each cover a distinct UX (multi-turn / one-shot / object-shape). The existing `react-nextjs` example demos all three on Next.js routes — `theo-demo` mirrors this but with theokit-framework routes.
  *Consequences:* enables visual diff between hook shapes side-by-side; requires 3 chat-thread variations; main `/chat` route uses `useTheoChat` (canonical), `/completion` uses `useTheoCompletion`, `/assistant` uses `useTheoAssistant`.

- **D211 — SSR enabled (`theokit ssr: true`).**
  *Rationale:* The `deploy-vercel` example smokes SSR — landing page works without JS execution. SEO + faster first-paint + match the framework's flagship feature.
  *Consequences:* enables SSR streaming; constrains: server routes must not assume browser-only state in render (acceptable — chat state lives in client after hydration).

- **D212 — Deploy target: Node self-host (primary) + Vercel chat-only mode (secondary).**
  *Rationale:* Original plan was "Vercel primary". Edge-case review EC-2 caught that Vercel Functions (serverless, stateless) cannot run 3 demo features: Ollama (localhost-bound), MCP filesystem (`child_process.spawn` between invocations), and eval-spawn (same). Vercel is still useful for showing the chat/memory/personality/completion/assistant surfaces but cannot be the headline deploy.
  *Consequences:* enables full-fidelity hosted demo via Node self-host (`theokit deploy --target node`); Vercel deploy works in "chat-only mode" with runtime guards on MCP/eval/Ollama; constrains marketing copy ("Deploy in one command" → "Self-host or deploy to Vercel (limited mode)").

- **D213 — `pnpm exec theokit eval` is forbidden; spawn the CLI via absolute path.**
  *Rationale:* Both the `theokit` framework (`0.1.0-alpha.5`) and `@usetheo/cli` (`0.1.0`) declare a `theokit` bin in their `package.json`. Installing both in `apps/theo-demo` creates `node_modules/.bin/theokit` collision — pnpm resolves last-installed-wins, which may bind the framework binary. T8.1 calling `pnpm exec theokit eval` would silently dispatch to the framework's `theokit dev/deploy` command (no `eval` subcommand) and fail confusingly.
  *Consequences:* T8.1 must spawn `node node_modules/@usetheo/cli/dist/bin/theokit.js eval ...` directly; future major-version of `@usetheo/cli` should rename bin to `theokit-cli` to avoid the collision permanently (out of scope this plan).

- **D215 — Pre-1.0 deps are pinned EXACT (no caret/tilde).**
  *Rationale:* Two external deps in this app are pre-1.0: `theokit@0.1.0-alpha.5` (framework, alpha) and `@usetheo/ui@0.1.0-next.0` (UI lib, prerelease). Standard semver caret semantics (`^0.1.0-alpha.5`) allow upgrades within `0.x`, which in pre-1.0 packages routinely contains breaking changes. A user cloning this repo six weeks from now would silently fetch a newer alpha/next and see the demo break.
  *Consequences:* `package.json` uses `"theokit": "0.1.0-alpha.5"` and `"@usetheo/ui": "0.1.0-next.0"` (no caret). Bumps are intentional PRs with CHANGELOG entries. Once `theokit` ships `1.0.0` and `@usetheo/ui` ships `1.0.0`, we MAY switch to caret.

- **D214 — Vercel deploy is guarded by `process.env.VERCEL === "1"` runtime check.**
  *Rationale:* When `VERCEL=1` env is set (Vercel auto-injects), the demo runtime: (1) forces `provider: "cloud"` regardless of saved settings (overrides D206 `local` selection because Ollama unreachable), (2) returns HTTP 503 from `/api/eval/run` with `{ error: "eval_unavailable_serverless" }`, (3) disables MCP filesystem in `agent-factory.ts` (the `mcpServers: {}` empty object). Local dev (`VERCEL` unset) gets full feature set.
  *Consequences:* enables Vercel deploy without misleading UX; UI must show subtle "running in chat-only mode" badge when `VERCEL=1` so user understands the limitation; self-host has zero limitations.

## Dependency Graph

```
Phase 0: Workspace scaffolding (apps/theo-demo/, pnpm-workspace.yaml)
   │
   ▼
Phase 1: Theokit framework boot (theo.config + layout + landing page)
   │
   ├──▶ Phase 2: Backend foundation (server/routes/, agent-factory, settings-store)
   │
   ▼
Phase 3: Chat thread MVP (POST /api/chat SSE + ChatThread UI + useAgentStream)
   │
   ├──▶ Phase 4: Multi-provider toggle (Ollama ↔ cloud, model-selector)   ┐
   │                                                                       │
   ├──▶ Phase 5: Memory sidebar (memory-editor on right rail)              │ parallel
   │                                                                       │
   ├──▶ Phase 6: Tools + tool-call display (4 custom + 1 MCP)              │
   │                                                                       │
   └──▶ Phase 7: Personality picker (model-selector in header)             ┘
                  │
                  ▼
            Phase 8: Eval integration (route + UI button → report)
                  │
                  ▼
            Phase 9: Polish (3 hook routes per D210, error states, empty states, onboarding)
                  │
                  ▼
            Phase 10: Deploy adapter (theokit deploy --target vercel) + README
                  │
                  ▼
            Phase 11: Dogfood QA (real-LLM end-to-end against Ollama)
```

Phase 0 → 1 → 2 → 3 sequential blockers. Phases 4-7 parallel after 3. Phase 8 depends on Phase 6 (tools surface) + Phase 7 (personality contract). Phase 9-11 sequential at end.

---

## Phase 0: Workspace Scaffolding

**Objective:** Create `apps/theo-demo/` as a workspace package + register in `pnpm-workspace.yaml`.

### T0.1 — Bootstrap `apps/theo-demo/`

#### Objective
New top-level `apps/` directory + first workspace member with a minimum `package.json` + `tsconfig.json` + Vite stub that builds clean.

#### Evidence
The repo currently has zero `apps/` directory; workspace glob is `packages/*`. Mastra and OpenClaw both maintain `apps/` for deployable products separate from libraries. Per D202, `apps/theo-demo/` is the chosen location.

#### Files to edit
```
pnpm-workspace.yaml                   — add `apps/*` glob
apps/theo-demo/package.json           (NEW)
apps/theo-demo/tsconfig.json          (NEW)
apps/theo-demo/.gitignore             (NEW)
apps/theo-demo/index.html             (NEW — Vite entry)
apps/theo-demo/theo.config.ts         (NEW — theokit framework config)
apps/theo-demo/CHANGELOG.md           (NEW)
package.json                          (root — no edit if globs already cover, else verify)
```

#### Deep file dependency analysis
- **`pnpm-workspace.yaml`**: currently lists `packages: - 'packages/*'`. Append `- 'apps/*'`. Existing workspace packages unaffected.
- **`apps/theo-demo/package.json`** (NEW): `name: "@usetheo/theo-demo"` (private `true`, never published), pinned deps: `"theokit": "0.1.0-alpha.5"` (EXACT pin, no caret — per EC-5: framework is pre-1.0 alpha, caret resolves can break breaking changes silently), `@usetheo/ui ^0.1.0-next.0`, `@usetheo/sdk: workspace:*`, `@usetheo/cli: workspace:*`, `react ^19`, `react-dom ^19`, `react-router ^7`, `zod ^3.25`, `expr-eval ^2.0.2` (T6.1 calculator — sandboxed, no `eval`).
- **`theo.config.ts`** (NEW): `defineConfig({ ssr: true })` per D211. Minimal — same shape as `theokit/examples/deploy-vercel/theo.config.ts`.

#### Deep Dives
- **Theokit dep source decision:** during dev, `theokit` is a sibling repo at `/home/paulo/Projetos/usetheo/theokit/packages/theo/`. We pin via npm EXACT version `"theokit": "0.1.0-alpha.5"` (no caret, no tilde — per ADR D215 + EC-5: alpha-grade framework). If we hit a bug, we test fixes in `theokit/` first, ship a new alpha bump, then bump here intentionally. NEVER `file:../../../theokit/packages/theo` (breaks for non-monorepo users). NEVER `^0.1.0-alpha.5` (allows silent breakage on alpha.6+).
- **`@usetheo/cli` workspace dep:** the CLI (Roadmap #1 just shipped) is `workspace:*`. The demo uses it via spawn for `theokit eval`.
- **Invariants:**
  - `pnpm install` at repo root must succeed AFTER this task.
  - `pnpm --filter @usetheo/theo-demo build` must succeed (Vite empty entry → no errors).
- **Edge cases:**
  - If `apps/*` glob conflicts with existing top-level `apps/` (none exists today — checked), abort and rethink.
  - If `react@19` types conflict with SDK's React types — pin both to same major.

#### Tasks
1. Add `- 'apps/*'` to `pnpm-workspace.yaml`.
2. Create `apps/theo-demo/package.json` with the locked deps above.
3. Create `apps/theo-demo/tsconfig.json` extending the repo's base config.
4. Create `apps/theo-demo/index.html` with a `<div id="root">` and Vite entry.
5. Create `apps/theo-demo/theo.config.ts` with `{ ssr: true }`.
6. Create `apps/theo-demo/CHANGELOG.md` `[Unreleased]` `### Added` for T0.1.
7. Add a tarball-or-pack test that asserts the package can be installed clean (smoke).
8. Run `pnpm install` at repo root and confirm zero errors.

#### TDD
```
RED:     test_workspace_includes_theo_demo()
         — pnpm-workspace.yaml contains `apps/*` glob
RED:     test_theo_demo_package_resolves()
         — pnpm install at root completes without errors; @usetheo/theo-demo present in node_modules
RED:     test_vite_build_minimal()
         — empty index.html + theo.config.ts compiles via `pnpm --filter @usetheo/theo-demo build`
GREEN:   Implement package.json + tsconfig + theo.config + index.html.
REFACTOR: None expected.
VERIFY:  pnpm install && pnpm --filter @usetheo/theo-demo build
```

#### Acceptance Criteria
- [ ] 3/3 RED → GREEN.
- [ ] `pnpm install` succeeds at root.
- [ ] `pnpm --filter @usetheo/theo-demo build` exits 0.
- [ ] Pass: biome lint zero warnings on touched files.
- [ ] Pass: tsc --noEmit clean.

#### DoD
- [ ] Tasks 1-8 done.
- [ ] CHANGELOG entry under `[Unreleased]` `### Added` mentioning the workspace bootstrap.

---

## Phase 1: Theokit Framework Boot

**Objective:** Boot the theokit dev server and render a placeholder landing page using `@usetheo/ui` chrome.

### T1.1 — Landing page + layout shell

#### Objective
`pnpm dev` boots `http://localhost:3000` and shows a minimal landing page (header with `TopNav` + body with hero card). React-Router root layout. Mirror of `theokit/examples/deploy-vercel/app/{layout,page}.tsx`, adapted for demo branding.

#### Evidence
Sibling `theokit/examples/deploy-vercel/app/layout.tsx` (verified during research) shows the canonical theokit layout shape: grid row layout, `Outlet` from react-router, `ThemeSwitcher` + `Tooltip` from `@usetheo/ui`. Reusing this shape avoids reinventing wheels.

#### Files to edit
```
apps/theo-demo/app/layout.tsx       (NEW)
apps/theo-demo/app/page.tsx         (NEW)
apps/theo-demo/app/styles.css       (NEW — Tailwind imports + TheoUI tokens)
apps/theo-demo/tailwind.config.ts   (NEW)
apps/theo-demo/postcss.config.js    (NEW)
```

#### Deep file dependency analysis
- **`app/layout.tsx`**: root layout. Imports `Outlet` from `react-router`, `ThemeSwitcher` + `Topnav` (`@usetheo/ui/topnav`) from `@usetheo/ui`. Renders header + main outlet. No routes wired yet — react-router resolves `<Outlet />` to the file-routed `page.tsx`.
- **`app/page.tsx`**: landing. Hero card with "Try the chat" CTA → links to `/chat` (Phase 3).
- **`tailwind.config.ts`**: includes the demo's app/ + components/ paths + `node_modules/@usetheo/ui/**/*.{js,ts}` so TheoUI's Tailwind classes are picked up.
- **`styles.css`**: `@import '@usetheo/ui/styles.css';` + `@import '@usetheo/ui/tokens.css';` + Tailwind directives.

#### Deep Dives
- **Theokit file-based routing**: `theokit` framework auto-routes `app/page.tsx` to `/`, `app/chat/page.tsx` to `/chat`, etc. No manual route table.
- **TopNav vs Topnav**: `@usetheo/ui` exports component as `Topnav` (single word). Verified via package.json exports.
- **Invariants:**
  - `pnpm dev` must show the page at `http://localhost:3000` within 5 seconds of boot.
  - No console errors on first load.

#### Tasks
1. Install `@usetheo/ui` + `theokit` + `react-router` deps (already in package.json from T0.1).
2. Create `tailwind.config.ts` with `@usetheo/ui` content paths.
3. Create `postcss.config.js` standard Tailwind setup.
4. Create `app/styles.css` importing TheoUI styles + Tailwind directives.
5. Implement `app/layout.tsx` with `Topnav` + `ThemeSwitcher`.
6. Implement `app/page.tsx` with hero card.
7. Add a test that the dev server boots + responds 200 on `/`.

#### TDD
```
RED:     test_landing_responds_200() — fetch http://localhost:3000/ → 200
RED:     test_landing_contains_demo_title() — body contains "Theo Demo" or similar
RED:     test_layout_renders_topnav() — body contains "topnav" data-component or visible chrome
GREEN:   Implement layout + page + Tailwind setup.
REFACTOR: None expected.
VERIFY:  pnpm --filter @usetheo/theo-demo dev (start) + manual curl OR vitest e2e via playwright stub
```

#### Acceptance Criteria
- [ ] Dev server boots in <5s.
- [ ] Landing page renders at `/` without console errors.
- [ ] TheoUI tokens (colors, fonts) applied correctly.
- [ ] Pass: biome lint, tsc clean.

#### DoD
- [ ] Tasks 1-7 done. CHANGELOG entry.

---

## Phase 2: Backend Foundation

**Objective:** Server routes + agent factory singleton + settings store.

### T2.1 — Agent factory + settings store + `/api/inspect` route

#### Objective
A `server/lib/agent-factory.ts` exposes a singleton agent instance composed via `@usetheo/sdk`'s `createAgentFactory` (D23). A `server/lib/settings-store.ts` reads/writes `<cwd>/.theokit/demo-settings.json`. A `/api/inspect` route returns `Theokit.inspect.*` for client-side rendering.

#### Evidence
Per D205, persistence is the SDK Memory layer; settings are filesystem JSON. The agent factory pattern (D23) is the canonical way to share an agent across requests — telegram-pro already uses it. `Theokit.inspect.*` (D201, just shipped via Roadmap #1) is the API for the inspect surface; client calls `/api/inspect` to render available providers + adapters.

#### Files to edit
```
apps/theo-demo/server/lib/agent-factory.ts    (NEW)
apps/theo-demo/server/lib/settings-store.ts   (NEW)
apps/theo-demo/server/lib/types.ts            (NEW — shared backend types)
apps/theo-demo/server/routes/inspect.ts       (NEW — GET /api/inspect)
apps/theo-demo/server/routes/health.ts        (NEW — smoke endpoint)
apps/theo-demo/tests/server/agent-factory.test.ts  (NEW)
apps/theo-demo/tests/server/settings-store.test.ts (NEW)
```

#### Deep file dependency analysis
- **`server/lib/agent-factory.ts`**: lazy-init singleton. `getAgent()` returns the cached agent. `swapModel(modelId)` swaps the model + invalidates the agent (next `getAgent()` recreates). `swapPersonality(slug | null)` calls `agent.usePersonality(slug, { save: true })`.
- **`server/lib/settings-store.ts`**: JSON read/write with atomic temp-rename (mirrors patterns in SDK `internal/persistence/`). `readSettings()` returns `{ provider, model, personality }`. `writeSettings(partial)` merges and writes. **EC-4 fix:** before atomic write, `await mkdir(dirname(settingsPath), { recursive: true })` — `.theokit/` may not exist on a fresh clone (it's gitignored), and `renameSync` would throw `ENOENT`.
- **`server/routes/inspect.ts`**: `defineRoute({ handler: () => ({ providers: Theokit.inspect.builtinProviders(), adapters: Theokit.inspect.embeddingAdapters() }) })`.

#### Deep Dives
- **Singleton pattern**: agent factory is module-level. Server framework may load it per-route — `theokit/server` uses lazy import; the factory's first `getAgent()` triggers `Agent.create(...)`. Subsequent calls return the cached instance.
- **Settings file location**: `<cwd>/.theokit/demo-settings.json`. The `.theokit/` dir is shared with Memory layer (D205). Atomic write via tmp-then-rename (mirrors EC-B from CLI plan).
- **Invariants:**
  - `getAgent()` must be idempotent across concurrent requests (no race in init).
  - `writeSettings()` must be atomic (no partial write visible to readers).
- **Edge cases:**
  - First-run (no settings file): return defaults (`{ provider: "auto", model: "ollama/llama3.2:3b", personality: null }`).
  - Malformed settings file: log warn, return defaults, do NOT crash.

#### Tasks
1. Implement `settings-store.ts` with atomic read/write + defaults.
2. Implement `agent-factory.ts` with lazy singleton + swap methods.
3. Implement `server/routes/inspect.ts` calling `Theokit.inspect.*`.
4. Implement `server/routes/health.ts` returning `{ ok: true, app: "theo-demo" }`.
5. Write tests covering: read defaults on first run, write+read round-trip, swap model, malformed file fallback.

#### TDD
```
RED:     test_settings_read_returns_defaults_when_missing()
RED:     test_settings_atomic_write_read_roundtrip()
RED:     test_settings_malformed_file_returns_defaults_with_warn()
RED:     test_settings_write_creates_dir_when_missing()  # EC-4: mkdir -p before atomic write
RED:     test_agent_factory_returns_same_instance()
RED:     test_agent_factory_swapModel_invalidates_cache()
RED:     test_inspect_route_returns_7_builtins()
RED:     test_health_route_returns_ok()
GREEN:   Implement files.
REFACTOR: None expected.
VERIFY:  pnpm --filter @usetheo/theo-demo test tests/server/
```

#### Acceptance Criteria
- [ ] 8/8 RED → GREEN.
- [ ] `/api/inspect` returns ≥ 7 providers + ≥ 6 adapters.
- [ ] `/api/health` returns `{ ok: true, app: "theo-demo" }`.
- [ ] Pass: biome lint, tsc --noEmit clean.

#### DoD
- [ ] Tasks 1-5 done. CHANGELOG entry.

---

## Phase 3: Chat Thread MVP

**Objective:** SSE chat endpoint + chat-thread UI + useAgentStream hook wired end-to-end. First real-LLM response visible on screen.

### T3.1 — `/api/chat` SSE route + `app/chat/page.tsx` UI

#### Objective
POST `/api/chat` with `{ messages: [...] }` returns an SSE stream of agent events (text deltas + tool calls + completion). React route `/chat` renders `<ChatThread>` from `@usetheo/ui` and consumes the stream via the `useAgentStream` hook from `@usetheo/ui/agent-stream`.

#### Evidence
The flagship demo feature. `@usetheo/ui` exports both `chat-thread` (visual) and `agent-stream` (hook) — this task is composing them with the SDK's `agent.send().stream()` API on the server side.

#### Files to edit
```
apps/theo-demo/server/routes/chat.ts          (NEW — POST /api/chat SSE)
apps/theo-demo/app/chat/page.tsx              (NEW — chat route)
apps/theo-demo/app/components/chat-shell.tsx  (NEW — composes ChatThread + composer)
apps/theo-demo/tests/server/chat.test.ts      (NEW)
apps/theo-demo/tests/app/chat-shell.test.tsx  (NEW — React Testing Library)
```

#### Deep file dependency analysis
- **`server/routes/chat.ts`**: POST handler. Reads `{ messages: SDKMessage[] }`. Calls `agent.send(lastUserMessage).stream()`. Pipes each event to the SSE writer. Closes stream on `wait()` completion. Returns `text/event-stream` headers.
- **`app/chat/page.tsx`**: client component (theokit framework's "use client" semantics). Imports `useAgentStream` from `@usetheo/ui/agent-stream` and `ChatThread` from `@usetheo/ui/chat-thread`. Wires them together with a state hook for messages.
- **`app/components/chat-shell.tsx`**: composition layer — combines `ChatThread` + `ChatComposer` (or `AgentComposer`) + handles empty state via `AgentStartingState`.

#### Deep Dives
- **SSE format**: each event is `data: {"type":"text-delta","text":"hello"}\n\n` followed by completion event `data: {"type":"done"}\n\n`. Matches `@usetheo/ui`'s `useAgentStream` expected wire shape (verified via UI lib source on first use). **EC-7 fix:** response headers MUST include `X-Accel-Buffering: no` + `Cache-Control: no-cache, no-transform` to prevent nginx/Vercel edge buffering the full stream.
- **Agent.send + stream contract**: `await agent.send(text).stream()` returns AsyncGenerator. We forward `text_delta`, `tool_use` (event from D86 tool-dispatch), and `stop` events. SDK shape stable per docs.md.
- **Empty state**: when no messages yet, render `<AgentStartingState>` from `@usetheo/ui/agent-starting-state` with sample prompts.
- **Invariants:**
  - Each user message → server processes → one final assistant message in response.
  - SSE stream MUST close on completion or error (no hanging connections).
- **Edge cases:**
  - Agent throws mid-stream → SSE writes `{"type":"error","message":"..."}` event then closes.
  - Client disconnects mid-stream → server aborts agent via `AbortController`.
  - Empty user message → 400.
  - **EC-11:** message text > 50000 chars → 413 Payload Too Large with `{ error: "message_too_long", limit: 50000 }`. Prevents UX-killing "tela travou" when user pastes a giant log.

#### Tasks
1. Implement SSE writer helper in `server/lib/sse.ts`.
2. Implement `server/routes/chat.ts` with abort handling.
3. Implement `app/components/chat-shell.tsx` composing ChatThread + Composer + AgentStartingState.
4. Implement `app/chat/page.tsx` rendering chat-shell.
5. Write tests covering: SSE stream events, abort, empty message rejection.

#### TDD
```
RED:     test_chat_post_returns_sse_headers_with_no_buffering()  # EC-7
RED:     test_chat_streams_text_delta_events()
RED:     test_chat_streams_tool_use_event() — when agent picks a tool
RED:     test_chat_emits_done_event_on_completion()
RED:     test_chat_emits_error_event_on_agent_throw()
RED:     test_chat_rejects_empty_message_with_400()
RED:     test_chat_rejects_message_above_50k_chars_with_413()  # EC-11
RED:     test_chat_shell_renders_empty_state_when_no_messages()
RED:     test_chat_shell_appends_assistant_message_on_stream() — RTL
GREEN:   Implement files.
REFACTOR: Extract SSE writer to dedicated module if used by >1 route.
VERIFY:  pnpm --filter @usetheo/theo-demo test
```

#### Acceptance Criteria
- [ ] 9/9 RED → GREEN.
- [ ] Sending "hello" in dev UI returns a streamed reply visibly.
- [ ] Empty user message → 400 with actionable error in UI.
- [ ] 100KB pasted text → 413 with "message too long" UI feedback (EC-11).
- [ ] Pass: biome lint, tsc --noEmit.

#### DoD
- [ ] Tasks 1-5 done. CHANGELOG entry.
- [ ] Manual smoke: open `/chat`, send "Say hi in one word", see streamed reply.

---

## Phase 4: Multi-Provider Toggle

**Objective:** Header dropdown lets user toggle between local Ollama and cloud auto-detect; switch applies without restart.

### T4.1 — `model-selector` integration + `/api/settings` route + agent reload

#### Objective
User clicks `<ModelSelector>` in topnav → picks "Ollama (local)" or "Cloud (auto)" → settings persist → agent factory swaps the model → next message uses the new provider. No restart, no page reload.

#### Evidence
The "100% local Ollama OR cloud auto-detect" promise of D182-D192 is the SDK's headline UX for local-first developers. Without a provider toggle in the demo, this is invisible.

#### Files to edit
```
apps/theo-demo/server/routes/settings.ts       (NEW — GET/PUT /api/settings)
apps/theo-demo/app/components/provider-toggle.tsx (NEW)
apps/theo-demo/app/layout.tsx                  (edit — wire toggle into topnav)
apps/theo-demo/app/hooks/use-settings.ts       (NEW — client settings sync)
apps/theo-demo/tests/server/settings.test.ts   (NEW)
apps/theo-demo/tests/app/provider-toggle.test.tsx (NEW)
```

#### Deep file dependency analysis
- **`server/routes/settings.ts`**: GET returns current settings JSON. PUT accepts `{ provider?, model?, personality? }`, validates against `Theokit.inspect.builtinProviders()` list, persists via `settings-store`, calls `agent-factory.swapModel()`.
- **`app/components/provider-toggle.tsx`**: uses `<ModelSelector>` from `@usetheo/ui/model-selector` (pre-built widget). Lists "local" (Ollama) and "cloud" (auto). On change, PUT `/api/settings`.
- **`app/hooks/use-settings.ts`**: client hook reading localStorage + falling back to `/api/settings` on mount. Optimistic UI update on change.

#### Deep Dives
- **Provider semantics**: "local" forces `model: "ollama/<configured>"`. "cloud" picks first available provider per env vars (Anthropic → OpenAI → OpenRouter, mirror of D186 inference).
- **Race**: if user toggles WHILE a chat stream is in-flight, the in-flight stream completes on the OLD model; the next message uses the NEW model. No mid-stream swap (would cascade complexity).
- **Invariants:**
  - PUT settings → next `getAgent()` returns the new model.
  - Invalid provider in PUT → 400.
- **Edge cases:**
  - Switching to local Ollama when Ollama is down → next chat shows `ollama_unreachable` error (D185) inline.
  - **EC-10:** switching to cloud with NO cloud env keys (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `OPENROUTER_API_KEY` all unset) → PUT /api/settings returns 400 `{ error: "no_cloud_provider_configured", hint: "Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or OPENROUTER_API_KEY, or stay on Ollama (local)." }`. UI surfaces hint in `<AgentErrorCard>`.

#### Tasks
1. Implement `server/routes/settings.ts` GET + PUT with validation.
2. Wire `agent-factory.swapModel()` to actually invalidate the cached agent.
3. Implement `provider-toggle.tsx` using `<ModelSelector>`.
4. Implement `use-settings.ts` hook with optimistic update + revalidation.
5. Mount toggle in `app/layout.tsx` topnav.
6. Tests.

#### TDD
```
RED:     test_settings_get_returns_current()
RED:     test_settings_put_persists_and_swaps_agent()
RED:     test_settings_put_rejects_unknown_provider()
RED:     test_settings_put_cloud_without_keys_returns_400_with_hint()  # EC-10
RED:     test_provider_toggle_renders_options()
RED:     test_provider_toggle_calls_put_on_change()
RED:     test_use_settings_returns_localStorage_first_then_revalidates()
GREEN:   Implement.
REFACTOR: None expected.
VERIFY:  pnpm --filter @usetheo/theo-demo test
```

#### Acceptance Criteria
- [ ] 7/7 RED → GREEN.
- [ ] Toggle from Ollama → cloud (or vice-versa) takes effect on next send (no page reload).
- [ ] Toggle to cloud without keys set → AgentErrorCard with actionable hint (EC-10).
- [ ] Pass: lint + tsc.

#### DoD
- [ ] Tasks 1-6 done. CHANGELOG entry.
- [ ] Manual smoke: toggle Ollama→cloud, send msg, observe response uses cloud model.

---

## Phase 5: Memory Sidebar

**Objective:** Right sidebar shows current memory facts; user can see "Theo remembered: …" live.

### T5.1 — `memory-editor` integration + `/api/memory` route

#### Objective
Right sidebar rail mounts `<MemoryEditor>` from `@usetheo/ui/memory-editor` showing facts the agent has stored. Updates live on each chat turn via re-fetch (post-stream).

#### Evidence
SDK's Memory layer (D141-D149 + D183 Ollama embedding) is the SDK's most differentiated feature. The demo MUST make memory visible to be believable — otherwise it's just another chat tool.

#### Files to edit
```
apps/theo-demo/server/routes/memory.ts            (NEW — GET /api/memory)
apps/theo-demo/app/components/memory-sidebar.tsx  (NEW)
apps/theo-demo/app/chat/page.tsx                  (edit — wrap chat-shell + memory-sidebar in 2-col layout)
apps/theo-demo/tests/server/memory.test.ts        (NEW)
```

#### Deep file dependency analysis
- **`server/routes/memory.ts`**: GET reads the SDK Memory store (via `agent.memory.recall(query)` or direct `.theokit/memory/` walk if no query). Returns `{ facts: [{ id, text, createdAt }] }`.
- **`memory-sidebar.tsx`**: client component. Polls `/api/memory` after each chat stream completes. Renders `<MemoryEditor>` (read-only mode initially; edit later as polish).

#### Deep Dives
- **Active vs passive recall**: the demo uses ACTIVE recall (D145) so the agent automatically fetches relevant facts before each send. The sidebar shows the FULL fact list independent of any specific query.
- **Invariants:**
  - GET /api/memory must never block longer than 500ms (use stored facts, no LLM call).

#### Tasks
1. Implement `server/routes/memory.ts` reading the SDK memory layer.
2. Implement `memory-sidebar.tsx` polling on chat completion.
3. Refactor `app/chat/page.tsx` to 2-col layout (chat-shell main + memory-sidebar right rail).
4. Tests.

#### TDD
```
RED:     test_memory_get_returns_facts_array()
RED:     test_memory_get_includes_recent_facts()
RED:     test_memory_sidebar_refetches_on_chat_complete()
GREEN:   Implement.
REFACTOR: None expected.
VERIFY:  pnpm --filter @usetheo/theo-demo test
```

#### Acceptance Criteria
- [ ] 3/3 RED → GREEN.
- [ ] Send "Remember: I'm a TypeScript dev" → sidebar shows the fact within 2s.
- [ ] Pass: lint + tsc.

#### DoD
- [ ] Tasks 1-4 done. CHANGELOG entry.

---

## Phase 6: Tools + Tool-Call Display

**Objective:** 4 custom tools + 1 MCP server; tool calls visible in chat as `<ToolCallCard>`.

### T6.1 — Custom tools (`get_current_time`, `calculator`, `search_memory`, `list_files`) + MCP filesystem + `ToolCallCard`

#### Objective
The agent has 4 custom `defineTool`-registered tools plus the `@modelcontextprotocol/server-filesystem` MCP server (sandboxed to a `<cwd>/sandbox/` subdir). When the agent calls a tool, the chat thread shows a `<ToolCallCard>` inline (collapsed by default, expandable to see input/output).

#### Evidence
Tools are the SDK's most-used feature but also the most invisible without UI. Showing them inline as cards matches Anthropic's Workbench + Mastra's playground UX.

#### Files to edit
```
apps/theo-demo/server/lib/tools.ts                  (NEW — 4 defineTool definitions)
apps/theo-demo/server/lib/agent-factory.ts          (edit — wire tools + mcpServers)
apps/theo-demo/server/routes/chat.ts                (edit — emit tool_use events on SSE)
apps/theo-demo/app/components/chat-shell.tsx        (edit — render ToolCallCard for tool_use events)
apps/theo-demo/sandbox/.gitkeep                     (NEW — MCP filesystem scope)
apps/theo-demo/tests/server/tools.test.ts           (NEW)
```

#### Deep file dependency analysis
- **`server/lib/tools.ts`**: 4 `defineTool` calls:
  - `get_current_time` — Zod `z.object({})`, returns ISO timestamp.
  - `calculator` — Zod `z.object({ expression: z.string() })`, evaluates via **`expr-eval` v2.0.2** (sandboxed math parser, no `eval` / `new Function`, no global access). **EC-3 fix:** NEVER use `eval(expression)` or `new Function(expression)` — RCE risk via prompt injection. Biome lint banishes `eval` and `Function` constructor identifiers from `server/lib/tools.ts`.
  - `search_memory` — Zod `z.object({ query: z.string() })`, calls `agent.memory.recall(query)`.
  - `list_files` — Zod `z.object({ pattern: z.string().optional() })`, lists `<sandbox>/` files via `safePathJoin` (D80). **EC-9 cap:** return at most 100 entries + `truncated: true` flag when source has more.
- **`agent-factory.ts`**: passes these tools + `mcpServers: { filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "<sandbox>"] } }` to `createAgentFactory`.
- **`chat.ts`**: when the agent's stream yields `tool_use` event, the SSE forwards it. The client renders `<ToolCallCard>`.

#### Deep Dives
- **MCP server lifecycle**: theokit's server framework supports persistent process spawning. MCP filesystem process spawns on first agent.send; the SDK's MCP layer (D24/D86) manages init handshake.
- **Sandbox path-guard**: `list_files` MUST use `safePathJoin` (D80) so `pattern: "../../../etc/passwd"` is rejected.
- **Invariants:**
  - Tool errors return `tool_result isError: true` (D89), never throw.
  - Custom tools are exposed but not auto-called — agent decides based on prompt.

#### Tasks
1. Implement 4 `defineTool` definitions in `server/lib/tools.ts`.
2. Wire tools + MCP filesystem in `agent-factory.ts`.
3. Edit SSE writer to emit `tool_use` and `tool_result` event types.
4. Render `<ToolCallCard>` in `chat-shell.tsx` for tool events.
5. Create `sandbox/` dir with `.gitkeep`.
6. Tests.

#### TDD
```
RED:     test_get_current_time_returns_iso_string()
RED:     test_calculator_evaluates_safe_expression()  # "(2+3)*4" → 20
RED:     test_calculator_rejects_unsafe_input()       # EC-3: "process.exit(1)" → ConfigurationError, process still alive
RED:     test_search_memory_calls_agent_memory_recall()
RED:     test_list_files_path_guard_rejects_traversal()
RED:     test_list_files_caps_at_100_entries()        # EC-9: sandbox w/ 500 files → returns 100 + truncated:true
RED:     test_agent_factory_registers_4_tools()
RED:     test_chat_sse_forwards_tool_use_event()
RED:     test_chat_shell_renders_ToolCallCard_for_tool_event() — RTL
GREEN:   Implement.
REFACTOR: None expected.
VERIFY:  pnpm --filter @usetheo/theo-demo test
```

#### Acceptance Criteria
- [ ] 9/9 RED → GREEN.
- [ ] Sending "What time is it?" surfaces a tool-call card inline.
- [ ] `list_files ../etc/passwd` rejected with path-traversal error visible in card.
- [ ] `calculator { expression: "process.exit(1)" }` → tool result `{ isError: true, error: "invalid_expression" }`, server process still alive after the call (EC-3).
- [ ] Biome lint forbids `eval(` and `new Function(` in `server/lib/tools.ts`.

#### DoD
- [ ] Tasks 1-6 done. CHANGELOG entry.

---

## Phase 7: Personality Picker

**Objective:** Header dropdown switches personality; the active personality's `description` shows in topnav; next message uses the new voice.

### T7.1 — Personality picker + ship 3 bundled presets

#### Objective
Ship 3 `.theokit/personalities/*.md` presets (coder, poet, analyst) at app boot, mount a personality picker in topnav, call `agent.usePersonality(slug, { save: true })` on change.

#### Evidence
Personality presets (D160-D169) are the SDK's most-visible-but-untested feature. Without a UI, users never see voice switching.

#### Files to edit
```
apps/theo-demo/.theokit/personalities/coder.md     (NEW)
apps/theo-demo/.theokit/personalities/poet.md      (NEW)
apps/theo-demo/.theokit/personalities/analyst.md   (NEW)
apps/theo-demo/server/routes/settings.ts           (edit — PUT supports personality field)
apps/theo-demo/app/components/personality-picker.tsx (NEW)
apps/theo-demo/app/layout.tsx                       (edit — mount picker)
apps/theo-demo/tests/server/settings-personality.test.ts (NEW)
```

#### Deep file dependency analysis
- **3 preset markdown files**: each with YAML frontmatter (`name`, `description`, `tools?` per D161) + system-prompt body. Coder = "Concise, code-first. No prose around code.", Poet = "Reply in haiku where natural.", Analyst = "Step-by-step reasoning, structured bullets.".
- **`personality-picker.tsx`**: uses a simple `<Select>` from `@usetheo/ui/select`. On change PUT `/api/settings { personality: slug | null }`.
- **`settings.ts` route**: when PUT includes `personality`, calls `agent-factory.swapPersonality(slug)`.

#### Deep Dives
- **Switch semantics**: per D164, switch preserves history + re-injects via D94 cache invalidation. The next message uses the new voice; previous messages stay.

#### Tasks
1. Write 3 preset markdown files.
2. Edit settings PUT to handle personality.
3. Wire `agent-factory.swapPersonality` to call `agent.usePersonality`.
4. Implement `personality-picker.tsx`.
5. Mount picker in topnav.
6. Tests.

#### TDD
```
RED:     test_3_presets_load_from_disk()
RED:     test_settings_put_personality_calls_usePersonality()
RED:     test_picker_lists_3_presets()
RED:     test_picker_emits_PUT_on_change()
GREEN:   Implement.
REFACTOR: None expected.
VERIFY:  pnpm --filter @usetheo/theo-demo test
```

#### Acceptance Criteria
- [ ] 4/4 RED → GREEN.
- [ ] Switch to "poet" → next reply is more poetic (verified manually).

#### DoD
- [ ] Tasks 1-6 done. CHANGELOG entry.

---

## Phase 8: Eval Integration

**Objective:** Button "Run eval" in topnav → spawns `@usetheo/cli eval` → renders markdown report inline.

### T8.1 — Eval route + UI button + bundled eval config

#### Objective
A POST `/api/eval/run` spawns `node node_modules/@usetheo/cli/dist/bin/theokit.js eval --config eval.config.mjs --output eval-report.md` in the demo's own cwd. **EC-1 fix:** NEVER use `pnpm exec theokit eval` or `npx theokit eval` — both `theokit` (framework) and `@usetheo/cli` declare a `theokit` bin and the resolver may pick the wrong binary silently. Always spawn via the explicit resolved path `require.resolve("@usetheo/cli/dist/bin/theokit.js")`. The route streams stdout to the client and returns the resulting markdown report. UI renders it via a markdown component.

#### Evidence
CLI ships eval (Roadmap #1, just shipped); the demo's job is to make it visible. Per D209, spawn the CLI rather than reimplement.

#### Files to edit
```
apps/theo-demo/eval.config.mjs                  (NEW — sample eval config)
apps/theo-demo/server/routes/eval.ts            (NEW — POST /api/eval/run, SSE for progress)
apps/theo-demo/server/lib/eval-spawn.ts         (NEW — child_process.spawn wrapper)
apps/theo-demo/app/eval/page.tsx                (NEW — eval runner UI)
apps/theo-demo/app/components/eval-runner.tsx   (NEW — "Run eval" button + markdown viewer)
apps/theo-demo/tests/server/eval.test.ts        (NEW)
```

#### Deep file dependency analysis
- **`eval.config.mjs`**: ships 3-5 sample prompts (greeting, math, time tool, memory recall) with `contains-expected` scorer.
- **`server/routes/eval.ts`**: POST handler spawns CLI as child process. Streams stdout to client via SSE. On completion, reads the generated report file + emits final `{type:"complete", report: "..."}` event.
- **`eval-runner.tsx`**: button click → POST /api/eval/run → stream events → render markdown via a lightweight markdown component (`marked` + DOMPurify OR `react-markdown`).

#### Deep Dives
- **Child process lifecycle**: `spawn(process.execPath, [resolvedCliPath, "eval", ...], { cwd: demoCwd, stdio: ["ignore", "pipe", "pipe"] })` where `resolvedCliPath = require.resolve("@usetheo/cli/dist/bin/theokit.js")`. **EC-1 fix:** absolute path avoids the `theokit` bin collision with the framework. On client disconnect, kill the child (`signal.addEventListener("abort", () => child.kill("SIGTERM"))`). **EC-6:** only ONE eval at a time — `let runningEval: ChildProcess | null = null`; second POST returns 409 Conflict.
- **Report rendering**: use `react-markdown` (one dep, sanitized) — NOT MDX (overkill).

#### Tasks
1. Write `eval.config.mjs` with sample dataset.
2. Implement `eval-spawn.ts` child process wrapper with abort.
3. Implement `server/routes/eval.ts` SSE handler.
4. Implement `eval-runner.tsx` button + markdown viewer.
5. Add `/eval` route via `app/eval/page.tsx`.
6. Tests.

#### TDD
```
RED:     test_eval_route_spawns_cli_via_resolved_path()  # EC-1: NOT pnpm exec
RED:     test_eval_route_streams_progress_via_sse()
RED:     test_eval_route_returns_final_report()
RED:     test_eval_route_returns_409_when_already_running()  # EC-6: concurrent eval guard
RED:     test_eval_runner_button_starts_run()
RED:     test_eval_runner_renders_markdown_report() — RTL with sample report
GREEN:   Implement.
REFACTOR: None expected.
VERIFY:  pnpm --filter @usetheo/theo-demo test
```

#### Acceptance Criteria
- [ ] 6/6 RED → GREEN.
- [ ] Click "Run eval" → see progress events + final markdown table with scores.
- [ ] Click "Run eval" while one is already running → button disabled, second POST returns 409 (EC-6).

#### DoD
- [ ] Tasks 1-6 done. CHANGELOG entry.

---

## Phase 9: 3-Hook Routes + Polish

**Objective:** Per D210, expose three hook UXs on separate routes; finalize empty/error states, onboarding, keyboard shortcuts.

### T9.1 — `/completion` (useTheoCompletion) + `/assistant<T>` (useTheoAssistant) routes

#### Objective
Two additional routes besides `/chat`:
- `/completion`: single-shot text generation (no multi-turn), composer + result panel.
- `/assistant<T>`: object-shaped streaming with a small schema (e.g., `{ summary, tags, sentiment }`) — visualized as a card.

#### Files to edit
```
apps/theo-demo/app/completion/page.tsx           (NEW)
apps/theo-demo/app/assistant/page.tsx            (NEW)
apps/theo-demo/server/routes/completion.ts       (NEW — POST /api/completion)
apps/theo-demo/server/routes/assistant.ts        (NEW — POST /api/assistant with schema)
apps/theo-demo/tests/server/completion.test.ts   (NEW)
apps/theo-demo/tests/server/assistant.test.ts    (NEW)
```

#### Tasks
1. `/api/completion` calls `Agent.prompt` (one-shot).
2. `/api/assistant` calls `Agent.streamObject<T>` with sample schema.
3. UI for both routes using `useTheoCompletion` / `useTheoAssistant` from `@usetheo/ui` (or `@usetheo/react`, verify in research).
4. Tests.

#### TDD
```
RED:     test_completion_post_returns_text()
RED:     test_assistant_post_streams_partial_then_complete()
RED:     test_completion_ui_renders_result()
RED:     test_assistant_ui_renders_card_with_fields() — RTL
GREEN:   Implement.
REFACTOR: None expected.
VERIFY:  pnpm --filter @usetheo/theo-demo test
```

#### Acceptance Criteria
- [ ] 4/4 RED → GREEN.

### T9.2 — Empty states, error boundaries, keyboard shortcuts, onboarding

#### Objective
Polish pass: empty states for every panel, error boundaries (using `<AgentErrorCard>` from `@usetheo/ui/agent-error-card`), `Cmd+K` opens command palette (using `<CommandPalette>` from UI lib), and a first-run banner explaining the 8 surfaces.

#### Files to edit
```
apps/theo-demo/app/components/onboarding-banner.tsx (NEW)
apps/theo-demo/app/components/error-boundary.tsx    (NEW)
apps/theo-demo/app/components/cmd-palette.tsx       (NEW)
apps/theo-demo/app/layout.tsx                        (edit — mount palette + onboarding)
apps/theo-demo/tests/app/*.test.tsx                  (NEW)
```

#### Tasks
1. Add error boundary wrapping the chat shell.
2. Add `Cmd+K` keyboard handler opening command palette. **EC-8 fix:** ignore the shortcut when `document.activeElement` is `INPUT` / `TEXTAREA` / `contenteditable=true` so user can type literal `Cmd+K` characters without palette stealing focus.
3. Add first-run banner with dismissal persisted in **cookie** (NOT localStorage). **EC-12 fix:** localStorage is browser-only, causes SSR/hydration mismatch when SSR renders banner as "visible" but client (with prior dismissal flag) renders as "hidden". Cookie is readable on both SSR and CSR with no mismatch.
4. Add empty states for memory sidebar, eval panel.
5. Tests.

#### TDD
```
RED:     test_cmd_k_opens_palette_when_no_input_focused()
RED:     test_cmd_k_ignored_when_input_focused()  # EC-8
RED:     test_error_boundary_renders_AgentErrorCard()
RED:     test_first_run_banner_uses_cookie_no_hydration_mismatch()  # EC-12
RED:     test_first_run_banner_dismiss_persists_across_reload()
GREEN:   Implement.
VERIFY:  pnpm --filter @usetheo/theo-demo test
```

#### Acceptance Criteria
- [ ] 5/5 RED → GREEN.
- [ ] Keyboard `Cmd+K` opens palette with quick actions, ignored when typing in a text input (EC-8).
- [ ] Error in any route shows actionable card (not stack trace).
- [ ] First-run banner appears on first load, dismissible, no React hydration warnings in console (EC-12).

---

## Phase 10: Deploy Adapter + README

**Objective:** `theokit deploy --target node` (primary, full fidelity) + `--target vercel` (secondary, chat-only mode per D214); README is a guided tour.

### T10.1 — Self-host (Node) + Vercel adapter + serverless guards + README

#### Files to edit
```
apps/theo-demo/vercel.json                   (NEW — chat-only mode)
apps/theo-demo/Dockerfile                    (NEW — self-host fidelity path)
apps/theo-demo/server/lib/runtime-mode.ts    (NEW — VERCEL=1 detection helper)
apps/theo-demo/server/lib/agent-factory.ts   (edit — skip MCP when serverless)
apps/theo-demo/server/routes/eval.ts         (edit — 503 when serverless)
apps/theo-demo/server/routes/settings.ts     (edit — force cloud when serverless)
apps/theo-demo/app/components/runtime-badge.tsx (NEW — "chat-only" badge when VERCEL=1)
apps/theo-demo/scripts/deploy-smoke.sh        (NEW)
apps/theo-demo/README.md                      (NEW — guided tour, NOT feature list)
```

#### Deep file dependency analysis
- **`runtime-mode.ts`**: exports `isServerless()` returning `process.env.VERCEL === "1" || process.env.AWS_LAMBDA_FUNCTION_NAME !== undefined`. Cached at module init.
- **`agent-factory.ts` edit**: at agent build time, `if (isServerless()) { mcpServers = {}; provider = "cloud"; }`.
- **`eval.ts` edit**: top of handler `if (isServerless()) return c.json({ error: "eval_unavailable_serverless", reason: "Eval spawns a child process; serverless runtimes do not support persistent processes. Use Node self-host." }, 503)`.
- **`settings.ts` edit**: PUT with `provider: "local"` in serverless → 400 `{ error: "local_provider_unavailable_serverless" }`.
- **`runtime-badge.tsx`**: small banner top-right "Chat-only mode (Vercel — install locally for full fidelity)" with link to README#self-host.

#### Tasks
1. Implement `runtime-mode.ts` + `isServerless()`.
2. Wire guards in `agent-factory.ts`, `eval.ts`, `settings.ts`.
3. Render `<RuntimeBadge>` in `app/layout.tsx` when `isServerless()`.
4. Copy + adapt `vercel.json` shape from `theokit/examples/deploy-vercel/`.
5. Write `Dockerfile` for self-host (Node 22 + pnpm + Ollama optional via `OLLAMA_HOST` env).
6. Write `deploy-smoke.sh` curl-based smoke test (200 on `/`, 200 on `/api/health`, 503 on `/api/eval/run` when `VERCEL=1` simulated).
7. Write README as a 5-section guided tour: (a) what this is, (b) 60s local try-it, (c) the 8 surfaces, (d) deploy: self-host (primary) → Vercel chat-only (secondary), (e) extending.

#### TDD
```
RED:     test_isServerless_returns_true_when_VERCEL_env_set()
RED:     test_eval_route_returns_503_when_serverless()
RED:     test_settings_put_local_rejected_when_serverless()
RED:     test_agent_factory_skips_mcp_when_serverless()
RED:     test_runtime_badge_renders_when_serverless()
GREEN:   Implement.
REFACTOR: None expected.
VERIFY:  VERCEL=1 pnpm --filter @usetheo/theo-demo test
```

#### Acceptance Criteria
- [ ] 5/5 RED → GREEN.
- [ ] Self-host Docker image builds and `docker run -p 3000:3000` boots demo at full fidelity.
- [ ] `theokit deploy --target vercel` smoke passes locally (skip if no Vercel CLI).
- [ ] When `VERCEL=1`: `/api/eval/run` → 503, `/api/settings PUT {provider:"local"}` → 400, MCP filesystem absent, runtime badge visible.
- [ ] README < 300 lines, scannable.

---

## Phase 11: Dogfood QA (MANDATORY)

**Objective:** End-to-end real-LLM walkthrough against Ollama.

### T11.1 — Real-LLM end-to-end dogfood

#### Acceptance Criteria
1. `pnpm install` clean at workspace root.
2. `cd apps/theo-demo && pnpm dev` boots in <10s.
3. Open `/chat`, send "Hello in one word" → streamed reply visible in <30s (Ollama warm).
4. Send "What time is it?" → `<ToolCallCard>` for `get_current_time` visible.
5. Send "Remember: I love TypeScript" → memory sidebar updates within 2s.
6. Switch personality to "poet" → next reply has poetic tone (judgment call).
7. Toggle provider Ollama → cloud (with cloud key set) → next message uses cloud.
8. Click "Run eval" on `/eval` route → report renders with ≥ 3 scored rows.
9. Visit `/completion`, send prompt, see single result.
10. Visit `/assistant`, see object-shaped streaming card.

If ANY step fails: identify root cause, add regression test, fix.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | No consolidated official demo | T0-T11 all | `apps/theo-demo/` ships |
| 2 | `theokit` framework integration invisible | T1.1 | Built ON theokit |
| 3 | `@usetheo/ui` agent primitives unused inside SDK repo | T3.1-T7.1 | 12+ components composed |
| 4 | Chat streaming UX missing | T3.1 | SSE + ChatThread |
| 5 | Multi-provider toggle missing | T4.1 | Header dropdown |
| 6 | Memory not visible in any example | T5.1 | Sidebar |
| 7 | Tool calls not visualized | T6.1 | ToolCallCard inline |
| 8 | Personality switching not visualized | T7.1 | Header picker |
| 9 | Eval suite has no UI consumer | T8.1 | `/eval` route |
| 10 | 3 React hooks (D40) only in `react-nextjs` example | T9.1 | 3 demo routes |
| 11 | Error UX not polished | T9.2 | AgentErrorCard + boundaries |
| 12 | Deploy story untested for SDK | T10.1 | Node self-host + Vercel chat-only |
| 13 | Real-LLM proof against Ollama | T11.1 | E2E dogfood |
| EC-1 | `theokit` bin name collision (framework vs CLI) | T8.1 | spawn via resolved path (D213) |
| EC-2 | Vercel breaks Ollama/MCP/eval | T10.1 | runtime-mode guard + D214 |
| EC-3 | Calculator eval injection | T6.1 | `expr-eval` + biome ban |
| EC-4 | `.theokit/` dir missing first-run | T2.1 | mkdir -p before write |
| EC-5 | theokit alpha caret pinning | T0.1 | EXACT pin `0.1.0-alpha.5` |
| EC-6 | Concurrent eval runs | T8.1 | 409 conflict guard |
| EC-7 | SSE buffering by reverse proxy | T3.1 | `X-Accel-Buffering: no` |
| EC-8 | `Cmd+K` steals input focus | T9.2 | skip when input focused |
| EC-9 | `list_files` unbounded output | T6.1 | cap at 100 + truncated flag |
| EC-10 | Cloud toggle with no env keys | T4.1 | 400 with actionable hint |
| EC-11 | Pasted 100KB message | T3.1 | 413 cap at 50000 chars |
| EC-12 | First-run banner SSR hydration | T9.2 | cookie instead of localStorage |

**Coverage: 13/13 gaps + 12/12 edge cases (100%)**

## Global Definition of Done

- [ ] All 12 phases completed.
- [ ] All tests passing: `pnpm --filter @usetheo/theo-demo test`.
- [ ] Zero Biome lint warnings in `apps/theo-demo/**`.
- [ ] Backward compatibility preserved: SDK + CLI + UI lib untouched (only consumed).
- [ ] `apps/*` workspace glob added; no other workspace member affected.
- [ ] Plan-specific criteria:
  - [ ] `pnpm dev` boots in <10s.
  - [ ] All 4 routes (`/`, `/chat`, `/completion`, `/assistant`, `/eval`) render without errors.
  - [ ] At least 10 `@usetheo/ui` components composed (chat-thread, agent-streaming, tool-call-card, model-selector, memory-editor, agent-starting-state, agent-error-card, command-palette, topnav, theme-switcher).
  - [ ] README is a guided tour, not a feature dump.
- [ ] **Dogfood QA PASS** (T11.1): 10-step real-LLM walkthrough against Ollama.
- [ ] **Runtime-metric proof:**
  - [ ] Streaming token latency ≤ 100ms p50 (Ollama warm).
  - [ ] Tool call → visible card in chat ≤ 200ms p50.
  - [ ] Personality switch → reply tone change within 1 turn (manual).

## Final Phase: Dogfood QA (MANDATORY)

See Phase 11. Plan is NOT done until T11.1 walkthrough passes.

### Execution

```bash
cd apps/theo-demo
pnpm install --ignore-workspace
ollama serve &
ollama pull llama3.2:3b
pnpm dev
# Open http://localhost:3000, run through 10-step T11.1 list.
```

### Acceptance Criteria

- [ ] All 10 T11.1 steps pass.
- [ ] Zero CRITICAL issues caused by this plan.
- [ ] Onboarding time (clone → first reply) ≤ 5 minutes assuming Ollama installed.

---

## Out of Scope (v1.0)

- **Multi-user auth** — single-user demo only. Adding Clerk/Auth.js requires TheoKit auth (not GA).
- **Persistent conversations** — chat history lives only in agent memory (SDK Memory layer); no separate "thread" model. v1.1+ work.
- **Voice mode** — WebRTC + Whisper streaming. Belongs in TheoCode Desktop, not the SDK demo.
- **Mobile-optimized layout** — desktop-first. Mobile polish v1.1+.
- **Real-time multi-cursor / collab** — n/a for single-user demo.
- **i18n** — English-only at v1. PT-BR overlay v1.1+.

## Risks & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `theokit` framework has breaking changes pre-1.0 | High | Med | EXACT pin `0.1.0-alpha.5` (no caret), bump explicitly (D215/EC-5) |
| `@usetheo/ui` component API drift | Med | Med | Pin to v0.1.0-next.0 exact; smoke test on every UI lib bump |
| Ollama model swap latency (D182 EC) makes UX jittery | Med | Med | Use `keep_alive: 24h` from D192; pre-warm at boot |
| Vercel deploy is chat-only mode by design | High | Low | Documented (D214); self-host is the primary deploy path |
| First-time visit slow if Ollama not pulled | High | Low | First-run banner instructs `ollama pull llama3.2:3b` |
| `theokit` bin name collision with `@usetheo/cli` | Med | High | All CLI spawns use resolved absolute path (D213/EC-1) |
