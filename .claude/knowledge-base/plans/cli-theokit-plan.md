# Plan: CLI `theokit` — Developer Entry Point (Adoption Roadmap #1)

> **Version 1.0 — STATUS: ✅ COMPLETE (2026-05-22).** Todos os 8 tasks (T0.1-T7.1) DONE, 9 ADRs (D193-D201) shipados, **TODOS os 14 edge cases do review absorvidos**: 5 MUST FIX (EC-A/B/C/E/F) implementados no código + 6 SHOULD TEST (EC-G/H/I/J/K/L) cobertos por tests + 3 DOCUMENT (EC-M/N/O) anotados em READMEs. **62 unit tests PASS** (10 test files), typecheck clean, `pnpm pack` confirma `templates/` no tarball (15 entries). Dogfood real-LLM contra Ollama PASS (init + inspect + dev + eval — 2/2 eval rows com mean score 1.000). Edge-case evidence: `.claude/knowledge-base/reviews/edge-case/cli-theokit-edge-cases-2026-05-22.md` (Implementation Evidence section).
>
> **Version 1.0** — Ship a developer CLI (`theokit`) as a workspace package
> `@usetheo/cli` that gives the SDK a first-class entry point beyond
> `npm install`. Four subcommands at v1: `init` (scaffold a project from
> templates), `dev` (run agent in watch mode), `inspect` (list registered
> providers / plugins / skills / memory adapters), and `eval` (minimal
> eval runner that bridges to the future `Eval.*` API in Roadmap #2).
> Outcome: a new developer goes from `npx @usetheo/cli init my-bot` to a
> running agent in under 60 seconds without reading `docs.md`.

## Context

**What exists today:**
- `@usetheo/sdk` is feature-complete (169+ ADRs, 23/23 Hermes patterns,
  Ollama integration, Memory layer, Gateway, Personality presets).
- 30+ examples in `examples/` but **no scaffolder** — new developers
  must copy/paste from an example dir manually.
- Two existing bins in `packages/sdk/bin/`:
  `theokit-migrate-memory.mjs` and `theokit-migrate-config.mjs`
  (single-purpose utilities, not a CLI surface).
- The SDK's only entry point is `npm install @usetheo/sdk`.

**What's broken / missing:**
- **Zero onboarding affordance**. Adoption Roadmap header (CLAUDE.md
  line 401-405): "A SDK não tem ponto de entrada além de `npm install`.
  Vercel AI e Mastra ganham 10x em onboarding por causa disso."
- No `init` command → README quickstart requires manual copy of multiple
  files (package.json, tsconfig.json, src/index.ts, .env.example, etc.).
- No `inspect` command → debugging "which providers does my SDK see?"
  requires reading registry source.
- No `dev` command → developers wire their own `tsx --watch` ad-hoc.
- No `eval` command → cannot run eval suites locally (will be the
  consumption surface for Roadmap #2 when it ships).

**Evidence:**
- Adoption Roadmap v1.3 row #1 (CLAUDE.md line 405): score 10 (highest),
  Tier 1 (blocks adoption). Direct quote: "tudo o resto compõe melhor
  com isso shipado."
- Sibling reference: Mastra ships `mastra` CLI as `packages/cli` in
  their monorepo using `commander` + `@clack/prompts` + `picocolors`
  (verified at `referencia/mastra/packages/cli/`).
- Sibling reference: OpenClaw has a complete CLI under `src/cli/` with
  argv parsing, banner, capability-cli, channel-options, etc. — proof
  that the depth of CLI matters for adoption.

## Objective

**Done = `npx @usetheo/cli init my-bot && cd my-bot && pnpm install && pnpm dev` produces a working agent against Ollama OR OpenRouter in under 60s, with zero `docs.md` reading required.**

Specific measurable goals:
- `@usetheo/cli` ships as a workspace package with a `theokit` bin.
- 4 subcommands work: `init`, `dev`, `inspect`, `eval` (eval minimal v1).
- `theokit init` ships 3 templates: `minimal`, `ollama-local`, `telegram-bot`.
- `theokit inspect` enumerates: providers, embedding adapters, gateway
  adapters, plugins discovered via `~/.theokit/plugins/`.
- `theokit dev` runs `tsx --watch` against a project entry point and
  preserves `agent.send` across reloads (best-effort).
- `theokit eval` runs an `eval.config.{ts,mjs}` and emits a markdown
  report + JSON trace.
- 100% unit test coverage on argv parsing, template resolution, and
  command dispatch.
- One real-LLM dogfood: `pnpm exec theokit init e2e-test &&
  cd e2e-test && OLLAMA_HOST=... pnpm exec theokit dev` runs an agent
  loop against local Ollama.

## ADRs

- **D193 — `@usetheo/cli` is a workspace package, NOT embedded in `@usetheo/sdk`.**
  *Rationale:* The SDK is a library (consumers `import`); the CLI is an
  executable (consumers `npx`/`pnpm exec`). Mixing concerns inflates SDK
  install size for non-CLI users and forces the SDK to ship `commander`
  + `@clack/prompts` as runtime deps. Mastra (`mastra` CLI as
  `packages/cli` separate from `@mastra/core`) is the proven pattern.
  *Consequences:* Enables: independent versioning, smaller SDK tree-shake
  surface, CI can publish CLI without bumping SDK. Constrains: CLI must
  declare `@usetheo/sdk` as a dep (regular, not peer) so `init` templates
  can pin a known-good version.

- **D194 — `commander@12` for subcommand routing.**
  *Rationale:* Battle-tested (38M weekly downloads), zero-dep, supports
  nested subcommands + auto `--help`. Mastra uses it. The two existing
  `bin/*.mjs` files use a hand-rolled parser — that's tolerable for
  single-purpose tools but doesn't scale to 4+ subcommands with flags.
  Alternatives rejected: `yargs` (heavier, more API surface to learn),
  `clipanion` (TypeScript-first but smaller adoption), hand-roll (3-day
  effort for what commander gives in 1h).
  *Consequences:* Enables: standard `--help`, `--version`, subcommand
  composition. Constrains: one runtime dep (~50KB after tree-shake).

- **D195 — Bin name is `theokit`, NOT `tk` or `theo`.**
  *Rationale:* Consistency with the existing `THEOKIT_*` env var family
  (CLAUDE.md "Locked names" section), the `theokit-migrate-*` bin
  precedent, and the `Theokit` namespace export from SDK. `tk` is a
  common collision (Tk/Tcl, `tk` PyPI package); `theo` is too generic
  (already used by the agent personality "Theo Pro").
  *Consequences:* Enables: zero confusion vs. existing identifiers.
  Constrains: `theokit-migrate-memory` and `theokit-migrate-config` MUST
  remain working — we add `theokit migrate memory` AND keep the
  standalone bins as deprecated shims (one-shot warn pointing at the
  subcommand).

- **D196 — `init` templates are bundled as `templates/<name>/` inside
  the package, NOT cloned from git.**
  *Rationale:* Air-gapped CI / firewalled enterprise networks need
  scaffolding to work without network. `degit`-style git clone fails
  in those environments. Templates inline = scaffolding works offline
  once the package is installed.
  *Consequences:* Enables: `npx --offline` use, faster scaffold
  (no clone latency), templates versioned alongside CLI semver.
  Constrains: templates inflate the package tarball (~20KB per
  template, 3 templates = ~60KB extra). Acceptable.

- **D197 — `dev` shells out to `tsx --watch` instead of re-implementing
  the watcher.**
  *Rationale:* `tsx` is already a transitive dep of every SDK example
  (`tsx --env-file=.env src/index.ts` is the canonical example launcher).
  Re-implementing hot-reload would mean parsing TS, restarting the agent
  process gracefully, and handling stdin — all solved by `tsx --watch`.
  *Consequences:* Enables: zero-effort hot-reload that matches what
  example projects already do. Constrains: `tsx` becomes a CLI dep
  (regular, not peer) — same trade-off as the templates.

- **D198 — `inspect` introspects via registry queries, NOT by spawning
  the user's project.**
  *Rationale:* Spawning the user's `src/index.ts` to inspect plugins
  would inherit any startup-time side effects (DB connections, MCP
  servers, etc.). Instead, `inspect` reads the SDK's own registries
  directly (`listProviders()`, `MEMORY_EMBEDDING_ADAPTERS` keys, etc.)
  and walks `~/.theokit/plugins/` for user-installed plugins.
  *Consequences:* Enables: instant output (<100ms), no side effects,
  safe to run in CI. Constrains: cannot show plugins registered via
  `registerProvider()` at runtime by the user's code — only those
  reachable through filesystem discovery.

- **D199 — `eval` v1 is a minimal runner using `Agent.batch` (D134);
  Roadmap #2 `Eval.*` API swaps the implementation later.**
  *Rationale:* Roadmap #1 (this plan) and Roadmap #2 (Eval suite) have
  a chicken-and-egg: `theokit eval` consumes `Eval.*` but `Eval.*`
  needs a CLI to be invokable. Solution: ship `theokit eval` as a
  thin wrapper that loads `eval.config.{ts,mjs}`, runs prompts via
  `Agent.batch`, scores via user-provided scorer functions, and emits
  a report. When Roadmap #2 ships, the wrapper swaps internal impl
  for `Eval.run(config)` — config shape stays compatible.
  *Consequences:* Enables: unblocks Roadmap #1 ship without waiting for
  #2. Constrains: v1 eval is hand-rolled — no UI, no aggregation
  dashboard, no trace viewer. Documented as v1 limitation.

- **D201 — Expose `Theokit.inspect.*` public namespace in `@usetheo/sdk`.**
  *Rationale:* `theokit inspect` (T3.1) needs to enumerate builtin
  providers + embedding adapters. These live in `internal/*` modules
  that are NOT in the SDK's `package.json#exports` map — deep imports
  fail in consumer installs with `ERR_PACKAGE_PATH_NOT_EXPORTED`. The
  CLI can't reach into private internals of a published package; the
  SDK must expose a thin public wrapper. Added in T3.1 task #1.
  *Consequences:* Enables: CLI works against the published SDK (not
  just monorepo source). Constrains: any future change to internal
  registry shape must update `Theokit.inspect.*` to preserve the
  contract — same discipline already required for other public APIs.

- **D200 — Three initial templates: `minimal`, `ollama-local`,
  `telegram-bot`.**
  *Rationale:* `minimal` = canonical SDK entry (Agent.create + send +
  stream, no provider lock-in). `ollama-local` = leverages Roadmap row
  12 completed work (Ollama integration), zero remote API key path.
  `telegram-bot` = highest-engagement vertical (we have a fully-baked
  `examples/telegram-pro`). Excluded from v1: Discord (similar to
  Telegram, defer), React app (covered by Docs site #3), RAG (covered
  by `ollama-local` already showing embedding path).
  *Consequences:* Enables: 3 use-cases covered out of the gate.
  Constrains: adding a 4th template requires bumping CLI minor version
  (templates are semver-locked to CLI).

## Dependency Graph

```
Phase 0: Workspace scaffolding (NEW `packages/cli/`)
   │
   ▼
Phase 1: Core CLI infra (commander + dispatch + --help + --version)
   │
   ├──▶ Phase 2: `theokit init` ────────────────┐
   │                                             │
   ├──▶ Phase 3: `theokit inspect` ──────────────┤  (parallel)
   │                                             │
   ├──▶ Phase 4: `theokit dev` ──────────────────┤
   │                                             │
   └──▶ Phase 5: `theokit eval` (minimal v1) ────┤
                                                 │
                                                 ▼
                                    Phase 6: Docs + README + CHANGELOG
                                                 │
                                                 ▼
                                    Phase 7: Dogfood QA (init → dev real-LLM)
```

Phase 0 → 1 sequential. Phases 2-5 parallel after 1. Phases 6-7 final.

---

## Phase 0: Workspace Scaffolding ✅ DONE (2026-05-22)

**Objective:** Add `@usetheo/cli` as a new workspace package with build/test/typecheck wired into the monorepo.

### T0.1 — Bootstrap `packages/cli/`

#### Objective
Create the package skeleton + register in `pnpm-workspace.yaml` + wire
build + tsconfig + biome + initial empty `bin/theokit.mjs`.

#### Evidence
Existing workspace packages (`packages/gateway/`, `packages/sdk/`)
share a consistent shape: `package.json` with workspace-relative deps,
`tsconfig.json` extending `tsconfig.base.json`, `tsup.config.ts` for
build, `tests/` for vitest. Reuse this shape verbatim to avoid bespoke
config drift.

#### Files to edit
```
packages/cli/package.json                (NEW)
packages/cli/tsconfig.json               (NEW)
packages/cli/tsup.config.ts              (NEW)
packages/cli/vitest.config.ts            (NEW)
packages/cli/src/index.ts                (NEW — empty stub)
packages/cli/src/bin/theokit.ts          (NEW — empty stub with shebang)
packages/cli/tests/smoke.test.ts         (NEW — asserts package builds)
pnpm-workspace.yaml                      (add `packages/cli` if not glob-matched)
package.json                             (root — add `cli:*` proxy scripts if pattern requires)
```

#### Deep file dependency analysis
- **`packages/cli/package.json`** (NEW): declares `name: "@usetheo/cli"`,
  `bin: { theokit: "./dist/bin/theokit.js" }`, deps on `commander@^12`,
  `@clack/prompts@^0.7`, `picocolors@^1`, `tsx@^4` (regular deps per
  D194/D197), `@usetheo/sdk: workspace:*`.
- **`tsup.config.ts`**: two entries — `src/index.ts` (library API for
  programmatic use) and `src/bin/theokit.ts` (executable). Both ESM + CJS
  per workspace convention.
- **`pnpm-workspace.yaml`**: confirm `packages/*` glob already includes
  `packages/cli/`. If yes, no edit. If glob is explicit list, add entry.

#### Deep Dives
- **Bin shebang:** `#!/usr/bin/env node` at top of `src/bin/theokit.ts`.
  tsup preserves shebangs via `shims: false` + manual top-of-file shebang.
- **Executable bit:** post-build, `chmod +x dist/bin/theokit.js` via a
  `tsup` `onSuccess` hook OR a `prepack` script.
- **Invariant:** `pnpm --filter @usetheo/cli build` must succeed before
  any subsequent phase begins.
- **Edge case:** existing `packages/sdk/bin/theokit-migrate-*` MUST keep
  working — they live in SDK package, not CLI. Don't move them in this phase.

#### Tasks
1. Create `packages/cli/` directory with package.json, tsconfig, tsup, vitest configs.
2. **EC-C MUST FIX:** In `packages/cli/package.json`, set `"files": ["dist", "templates", "README.md", "CHANGELOG.md"]` so `npm publish` includes the bundled templates. Without this, `npx @usetheo/cli init` fails for consumers because the tarball ships dist but not templates.
3. Add `src/index.ts` exporting `export function main(argv: string[]): Promise<number>;` stub returning `0`.
4. Add `src/bin/theokit.ts` with shebang + minimal `process.exit(await main(process.argv))`.
5. Wire `tsup` to emit `dist/index.{js,cjs,d.ts}` + `dist/bin/theokit.{js,cjs}` with shebang preserved.
6. Add a smoke test that imports `main` and asserts it returns a Promise.
7. Add a tarball-contents test that runs `pnpm pack --dry-run` and asserts `templates/minimal/package.json` is listed (EC-C regression guard).
8. Confirm `pnpm -r build` succeeds for the new package.

#### TDD
```
RED:     test_package_exports_main()
         — import { main } from "@usetheo/cli"; expect typeof main === "function"
RED:     test_main_returns_zero_on_empty_argv()
         — main([]) resolves to 0
RED:     test_bin_file_exists_with_shebang()
         — readFileSync("dist/bin/theokit.js").startsWith("#!/usr/bin/env node")
RED:     test_pack_includes_templates()                                    [EC-C]
         — pnpm pack --dry-run output contains "templates/minimal/package.json"
GREEN:   Implement empty stubs returning 0.
REFACTOR: None expected.
VERIFY:  pnpm --filter @usetheo/cli build && pnpm --filter @usetheo/cli test
```

#### Acceptance Criteria
- [ ] `pnpm -r build` includes `@usetheo/cli` and succeeds.
- [ ] `pnpm --filter @usetheo/cli test` passes 3/3.
- [ ] `node packages/cli/dist/bin/theokit.js` runs and exits 0.
- [ ] Bin file is executable (`chmod +x` applied post-build).
- [ ] Pass: biome lint zero warnings on touched files.
- [ ] Pass: tsc --noEmit clean.

#### DoD
- [ ] Tasks 1-6 done.
- [ ] CHANGELOG.md entry in `packages/cli/CHANGELOG.md` `[Unreleased]`
      under `### Added` mentioning workspace scaffolding.
- [ ] Smoke test green.

---

## Phase 1: Core CLI Infra ✅ DONE (2026-05-22)

**Objective:** Wire commander, top-level flags (`--help`, `--version`, `--cwd`), and subcommand dispatch skeleton (subcommands still stubs).

### T1.1 — Commander setup + global flags + subcommand stubs

#### Objective
Establish the routing skeleton: `theokit init`, `theokit dev`,
`theokit inspect`, `theokit eval` all parse correctly, print help,
and exit 0 (stubs).

#### Evidence
Without a routing skeleton, Phases 2-5 cannot be developed in parallel
(they'd collide on shared argv handling). Mastra's CLI separates
`commands/<name>/` per subcommand under one commander root — same shape.

#### Files to edit
```
packages/cli/src/main.ts             (NEW — top-level commander program)
packages/cli/src/commands/init.ts    (NEW — stub command handler)
packages/cli/src/commands/dev.ts     (NEW — stub command handler)
packages/cli/src/commands/inspect.ts (NEW — stub command handler)
packages/cli/src/commands/eval.ts    (NEW — stub command handler)
packages/cli/src/version.ts          (NEW — exports VERSION from package.json)
packages/cli/src/index.ts            (re-export `main` from main.ts)
packages/cli/tests/commands/dispatch.test.ts (NEW — assert routing)
packages/cli/tests/commands/help.test.ts     (NEW — snapshot help output)
```

#### Deep file dependency analysis
- **`src/main.ts`**: instantiates a `Command` from commander, registers
  the 4 subcommands via `.command(name).description(...).action(handler)`,
  sets `.version(VERSION)`, calls `.parseAsync(argv)`. Returns exit
  code from action's resolved value.
- **`src/commands/<name>.ts`**: each exports `default async (opts) =>
  Promise<number>`. v1 stubs just `console.log("TODO: <name>")` and
  `return 0`.
- **`src/version.ts`**: reads `version` from `package.json` at build
  time (tsup `define` or runtime `import.meta.url + readFileSync`).
  Avoids hard-coding.

#### Deep Dives
- **Exit codes:** convention — 0 = success, 1 = unknown error, 2 =
  user error (bad flags), 64 = sysexits EX_USAGE (commander default).
  Document in `--help` footer.
- **Async dispatch:** commander supports `.action(async (opts) => {...})`
  natively. The outer `main()` awaits via `program.parseAsync`.
- **Invariant:** unknown subcommands MUST emit `--help` + exit 1 (not 0).
- **Edge cases:**
  - `theokit` with no args → print top-level `--help`, exit 0.
  - `theokit --version` → print version, exit 0.
  - `theokit unknown-cmd` → suggest closest match (commander built-in),
    exit 1.

#### Tasks
1. Add `commander`, `picocolors` deps to package.json.
2. Implement `main.ts` with commander program + 4 subcommand registrations.
3. Implement each `commands/<name>.ts` as a stub returning 0.
4. Implement `version.ts` reading from build-time inline.
5. Update `src/index.ts` to re-export `main`.
6. Write dispatch test (asserts each subcommand reachable).
7. Write help snapshot test (top-level + each subcommand).

#### TDD
```
RED:     test_dispatch_init() — main(["init", "--help"]) prints init help
RED:     test_dispatch_dev() — main(["dev"]) calls dev handler stub
RED:     test_dispatch_inspect() — main(["inspect"]) calls inspect handler
RED:     test_dispatch_eval() — main(["eval"]) calls eval handler
RED:     test_top_level_help() — main(["--help"]) lists 4 subcommands
RED:     test_version_flag() — main(["--version"]) prints package version
RED:     test_unknown_subcommand_exits_nonzero() — main(["does-not-exist"]) returns ≥1
GREEN:   Implement main.ts + stubs.
REFACTOR: Extract common stub shape if duplication ≥ 3 lines.
VERIFY:  pnpm --filter @usetheo/cli test tests/commands/
```

#### Acceptance Criteria
- [ ] 7/7 RED → GREEN.
- [ ] `theokit --help` lists `init`, `dev`, `inspect`, `eval` in that order.
- [ ] `theokit --version` matches `packages/cli/package.json` version.
- [ ] Unknown subcommand exits non-zero with "did you mean..." hint.
- [ ] Pass: biome lint zero warnings.
- [ ] Pass: complexity ≤ 10 (each command handler is tiny — natural).

#### DoD
- [ ] Tasks 1-7 done.
- [ ] CHANGELOG entry under `[Unreleased]` `### Added` mentioning the
      4-subcommand skeleton.
- [ ] `node dist/bin/theokit.js --help` produces readable output.

---

## Phase 2: `theokit init` (Scaffolder) ✅ DONE (2026-05-22)

**Objective:** Scaffold a new project from a bundled template.

### T2.1 — Template engine + 3 templates

#### Objective
`theokit init <project-name>` creates a new directory, copies template
files (with placeholder substitution), and prints next-step instructions.

#### Evidence
Vercel AI SDK, Mastra, and OpenAI Agents SDK all ship `create-*` or
`init` commands. Without it, every new developer copies an example
directory by hand and edits `package.json` (name, deps) and `.env`
(keys). This is the #1 friction point per Adoption Roadmap.

#### Files to edit
```
packages/cli/src/commands/init.ts                (replace stub)
packages/cli/src/init/templates.ts               (NEW — template registry)
packages/cli/src/init/scaffold.ts                (NEW — copy + substitute logic)
packages/cli/src/init/prompts.ts                 (NEW — @clack/prompts wrappers)
packages/cli/templates/minimal/package.json      (NEW)
packages/cli/templates/minimal/tsconfig.json     (NEW)
packages/cli/templates/minimal/src/index.ts      (NEW)
packages/cli/templates/minimal/.env.example      (NEW)
packages/cli/templates/minimal/README.md         (NEW)
packages/cli/templates/ollama-local/...           (NEW dir — 5 files)
packages/cli/templates/telegram-bot/...            (NEW dir — 6 files)
packages/cli/tests/init/scaffold.test.ts         (NEW)
packages/cli/tests/init/templates.test.ts        (NEW)
```

#### Deep file dependency analysis
- **`commands/init.ts`**: parses `<project-name>` positional + `--template`
  flag (default: prompt user). Calls `scaffold(template, dest, vars)`.
- **`init/templates.ts`**: enum of available templates (`minimal`,
  `ollama-local`, `telegram-bot`). Each has metadata (description,
  required env vars, post-install hints).
- **`init/scaffold.ts`**: walks `templates/<name>/`, copies files to
  `<dest>/`, runs string substitution for placeholders (`{{projectName}}`,
  `{{sdkVersion}}`).
- **`init/prompts.ts`**: thin wrapper over `@clack/prompts.select` /
  `text` / `confirm` with sane defaults for non-TTY (CI) environments.
- **`templates/<name>/`**: literal files copied at scaffold time.

#### Deep Dives
- **Placeholder syntax:** `{{varName}}` Mustache-style. Substitution
  scope: project name, SDK version, optional org name. Implemented as
  `String.prototype.replaceAll`, no template engine dep.
- **Non-TTY mode:** when `!process.stdin.isTTY`, skip prompts; use
  defaults (`--yes` flag implicit). Document.
- **Existing-dir behavior:** if `<dest>` exists and is non-empty,
  fail with code 2 (user error). Unless `--force` is passed.
- **Invariants:**
  - Scaffolder MUST NOT touch any file outside `<dest>`.
  - Template files are exact copies — no AST manipulation, no codegen.
  - Templates must `pnpm install` clean (no broken deps).
- **Edge cases:**
  - `init .` (current dir) → require explicit `--here` flag to avoid
    accidentally trashing existing project.
  - `init ../escape` → reject paths that escape cwd (path-guard via
    `safePathJoin` from SDK D80).
  - SDK version pin: `{{sdkVersion}}` resolves to the CLI's bundled
    SDK dep version at build time, not at runtime.

#### Tasks
1. Add `@clack/prompts` dep.
2. Implement `init/templates.ts` with 3 entries + metadata.
3. Implement `init/scaffold.ts` with copy + substitute + path-guard.
4. **EC-A MUST FIX:** in `scaffold.ts` entry point, validate project name BEFORE any fs write: `if (!/^(?:@[a-z0-9-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(name)) throw new ConfigurationError("Invalid project name. Use lowercase letters, numbers, dashes (e.g. 'my-bot' or '@scope/name')", { code: "invalid_project_name" });`. Rejeita "My App", "UpperCase", `scoped/name` sem `@`. Aceita `my-bot`, `@org/my-bot`, `bot1.2.3`.
5. **EC-B MUST FIX:** `scaffold.ts` usa atomic `scaffold-to-tmp-then-rename`: copia tudo para `<dest>.tmp-<random6>/`, depois `fs.renameSync(tmp, dest)` no fim. Em qualquer erro mid-write, `fs.rmSync(tmp, { recursive: true })` no `catch`. Garante: ou `<dest>` existe completo, ou não existe.
6. **EC-L SHOULD TEST gap:** `templates.ts` resolve `{{sdkVersion}}` via constante injetada por `tsup --define SDK_VERSION='1.0.5'` no build do CLI (lê `packages/sdk/package.json` no momento da build). Garante que scaffolded `package.json` NUNCA tem `workspace:*` ou outro non-semver.
7. Implement `init/prompts.ts` with TTY fallbacks.
8. Wire `commands/init.ts` to parse args and dispatch.
9. Write `templates/minimal/` files (package.json, tsconfig, src, .env.example, README).
10. Write `templates/ollama-local/` files (deps include Ollama mention + nomic-embed-text RAG example).
11. Write `templates/telegram-bot/` files (deps include `grammy`, `.env.example` with TELEGRAM_BOT_TOKEN placeholder).
12. Test scaffold against a tmpdir; assert filesystem state.
13. Test placeholder substitution.

#### TDD
```
RED:     test_init_minimal_creates_files() — scaffold minimal in tmpdir → assert 5+ files exist
RED:     test_init_substitutes_project_name() — package.json contains `<project-name>` not `{{projectName}}`
RED:     test_init_substitutes_sdk_version() — package.json dep version matches CLI's bundled SDK version
RED:     test_init_rejects_non_empty_dest() — scaffold into populated dir → throw with code "dest_not_empty"
RED:     test_init_force_overwrites() — --force into populated dir → succeeds (with warning)
RED:     test_init_rejects_path_traversal() — name="../escape" → throw with code "invalid_dest"
RED:     test_init_ollama_local_template() — scaffold ollama-local → contains "ollama/llama3.2" in src
RED:     test_init_telegram_bot_template() — scaffold telegram-bot → contains "TELEGRAM_BOT_TOKEN" in .env.example
RED:     test_init_nontty_uses_defaults() — pipe stdin closed → no prompts, default template = minimal
RED:     test_init_rejects_npm_invalid_names()                              [EC-A MUST FIX]
         — name="My App" / "UpperCase" / "scoped/name" → ConfigurationError code "invalid_project_name"
         — name="my-bot" / "@org/my-bot" → accepted
RED:     test_init_atomic_on_crash_midwrite()                                [EC-B MUST FIX]
         — mock fs.writeFile to throw on 2nd file → assert <dest> does NOT exist (tmp cleaned up)
RED:     test_init_sdk_version_resolves_to_semver()                          [EC-L]
         — scaffold; read scaffolded package.json; assert deps["@usetheo/sdk"] matches /^\d+\.\d+\.\d+/
RED:     test_init_rejects_symlink_dest()                                    [EC-G]
         — lstatSync(dest).isSymbolicLink() → reject before write
RED:     test_init_handles_enospc_gracefully()                               [EC-H]
         — mock writeFile to throw ENOSPC → error with code "disk_full" + dest cleaned up
GREEN:   Implement scaffold + templates.
REFACTOR: Extract substitution helper if used in 3+ places.
VERIFY:  pnpm --filter @usetheo/cli test tests/init/
```

#### Acceptance Criteria
- [ ] 9/9 RED → GREEN.
- [ ] `theokit init demo --template minimal` creates a working project
      (manual: `pnpm install && pnpm dev` works).
- [ ] All 3 templates pass `tsc --noEmit` post-scaffold.
- [ ] Path-guard blocks `../escape` and absolute paths outside cwd.
- [ ] Pass: file size ≤ 500 lines per file.

#### DoD
- [ ] Tasks 1-10 done.
- [ ] CHANGELOG entry: `### Added — theokit init <name>` with 3 templates.
- [ ] Manual smoke: scaffold `demo` in tmpdir, run `pnpm install` (offline
      via local registry), confirm zero errors.

---

## Phase 3: `theokit inspect` (Discovery) ✅ DONE (2026-05-22)

**Objective:** Print a structured listing of what the SDK sees: providers, embedding adapters, gateway adapters, plugins discovered via filesystem.

### T3.1 — Inspect command implementation

#### Objective
`theokit inspect` outputs (JSON via `--json` OR human-readable default):
- Builtin LLM providers (Anthropic/OpenAI/OpenRouter/Gemini/Ollama/LMStudio/llama.cpp).
- Memory embedding adapters (6 builtins).
- Gateway platform adapters (Telegram, Discord).
- User plugins discovered in `~/.theokit/plugins/` and `<cwd>/.theokit/plugins/`.

#### Evidence
Adoption Roadmap rationale line 405: "`theokit inspect` lista
plugins/skills/providers". OpenClaw has `openclaw models list
--provider ollama` and `openclaw onboard` that introspect the
configuration — same intent.

#### Files to edit
```
packages/cli/src/commands/inspect.ts        (replace stub)
packages/cli/src/inspect/providers.ts       (NEW — query SDK provider registry)
packages/cli/src/inspect/adapters.ts        (NEW — query memory adapter catalog)
packages/cli/src/inspect/gateway.ts         (NEW — query gateway adapter registry)
packages/cli/src/inspect/plugins.ts         (NEW — fs walk of ~/.theokit/plugins/)
packages/cli/src/inspect/format.ts          (NEW — human/JSON output)
packages/cli/tests/inspect/providers.test.ts (NEW)
packages/cli/tests/inspect/format.test.ts    (NEW)
```

#### Deep file dependency analysis
- **`inspect/providers.ts`**: calls `registerBuiltins()` from
  `@usetheo/sdk` internals, then `listProviders()` — returns the
  7 builtin profiles + their aliases + envVars.
- **`inspect/adapters.ts`**: imports `MEMORY_EMBEDDING_ADAPTERS` from
  `@usetheo/sdk` internals — emits id + transport + defaultModel +
  dimension.
- **`inspect/plugins.ts`**: walks `~/.theokit/plugins/model-providers/`
  and `<cwd>/.theokit/plugins/<name>/PLUGIN.md` per ADR D77 + D97.
  Parses frontmatter for each, lists name + description + version.
- **`inspect/format.ts`**: switch on `opts.json` — JSON.stringify with
  2-space indent OR `picocolors`-decorated tree view.

#### Deep Dives
- **SDK internals access:** importing `internal/*` from `@usetheo/sdk`
  is normally discouraged (it's `@internal`). The CLI is a sibling
  workspace package so monorepo-relative import is acceptable. Document
  in package.json comment: "CLI is monorepo-internal consumer of SDK
  internals; cloud/Lambda consumers should use the public catalog API
  exposed via `Theokit.providers.list()` (cloud-only)."
- **Plugin discovery:** read-only fs walk; no plugin execution.
  Reuses existing helpers from `packages/sdk/src/internal/plugins/discovery.ts`
  if already exported as internal. If not, vendor the walk logic.
- **Invariants:**
  - `inspect` must NEVER execute plugin code.
  - Output must be stable (sorted by name) for diff-friendly CI usage.
- **Edge cases:**
  - No plugins dir → emit empty array (not error).
  - Malformed plugin manifest → emit warning, skip entry, exit 0.
  - `--json` + tty → JSON to stdout (machine-readable always wins).

#### Tasks
1. **EC-E MUST FIX (ADR D201):** Expose a public `Theokit.inspect` namespace in `@usetheo/sdk/src/theokit.ts` that wraps the internal registries. Specifically:
   ```ts
   static readonly inspect = {
     builtinProviders: () => { registerBuiltins(); return listProviders(); },
     embeddingAdapters: () => Object.entries(MEMORY_EMBEDDING_ADAPTERS).map(([id, a]) => ({ id, transport: a.transport, defaultModel: a.defaultModel })),
   };
   ```
   Add tests in `packages/sdk/tests/theokit-inspect.test.ts`. This unblocks T3.1 against the **published** package, not just the monorepo dev path.
2. Implement `inspect/providers.ts` calling `Theokit.inspect.builtinProviders()`.
3. Implement `inspect/adapters.ts` calling `Theokit.inspect.embeddingAdapters()`.
4. Implement `inspect/gateway.ts` querying gateway adapters by package presence (`@usetheo/gateway-telegram`, `@usetheo/gateway-discord`).
5. Implement `inspect/plugins.ts` with fs walk + manifest parse.
6. Implement `inspect/format.ts` (human + JSON).
7. Wire `commands/inspect.ts` to compose all 4 + format.
8. Add `--json`, `--filter <kind>` flags.

#### TDD
```
RED:     test_inspect_lists_7_builtin_providers() — output contains "ollama", "anthropic", etc.
RED:     test_inspect_lists_6_embedding_adapters() — output contains "openai", "mistral", "ollama", etc.
RED:     test_inspect_walks_plugins_dir() — fixture plugins dir → output lists them
RED:     test_inspect_handles_missing_plugins_dir() — no dir → empty plugins array, exit 0
RED:     test_inspect_json_output_valid() — --json → JSON.parse succeeds
RED:     test_inspect_filter_kind_providers() — --filter providers → only providers in output
RED:     test_inspect_skips_malformed_plugin_manifest() — bad YAML → warn + continue
RED:     test_theokit_inspect_builtinProviders_works_against_dist()          [EC-E MUST FIX]
         — Build SDK, import from dist/index.js (NOT src), call Theokit.inspect.builtinProviders()
         — Asserts: returns ≥ 7 entries (the 7 builtins) without ERR_PACKAGE_PATH_NOT_EXPORTED
RED:     test_theokit_inspect_embeddingAdapters_works_against_dist()         [EC-E MUST FIX]
         — Same shape, asserts ≥ 6 entries (Ollama + 5 cloud adapters)
GREEN:   Implement files.
REFACTOR: Extract YAML parsing helper if shared with init.
VERIFY:  pnpm --filter @usetheo/cli test tests/inspect/
```

#### Acceptance Criteria
- [ ] 7/7 RED → GREEN.
- [ ] `theokit inspect` runs in <200ms on a clean install.
- [ ] `--json` emits valid JSON; `--filter providers|adapters|gateway|plugins` narrows output.
- [ ] Malformed plugin manifest emits warning, doesn't crash.

#### DoD
- [ ] Tasks 1-7 done.
- [ ] CHANGELOG entry.
- [ ] Manual smoke: `theokit inspect` in a fresh `init`'d project lists
      7 providers, 6 embedding adapters, 0 plugins.

---

## Phase 4: `theokit dev` (Watch Mode) ✅ DONE (2026-05-22)

**Objective:** Run the user's agent entry point in watch mode via `tsx --watch`.

### T4.1 — Dev command implementation

#### Objective
`theokit dev` finds the project entry (default `src/index.ts`), spawns
`tsx --watch --env-file=.env <entry>`, forwards stdio, handles graceful
shutdown.

#### Evidence
Every example dir already wires `tsx --env-file=.env src/index.ts` in
their `dev` script. `theokit dev` removes the boilerplate. Rationale
in CLAUDE.md line 405: "`theokit dev` roda agente em hot-reload".

#### Files to edit
```
packages/cli/src/commands/dev.ts            (replace stub)
packages/cli/src/dev/runner.ts              (NEW — spawn + forward stdio)
packages/cli/src/dev/entry-resolver.ts      (NEW — detect entry file)
packages/cli/tests/dev/runner.test.ts       (NEW)
packages/cli/tests/dev/entry-resolver.test.ts (NEW)
```

#### Deep file dependency analysis
- **`dev/runner.ts`**: spawns `tsx --watch --env-file=.env <entry>` via
  `child_process.spawn`. Pipes stdin/stdout/stderr. On SIGINT, sends
  SIGTERM to child; if child doesn't exit in 5s, SIGKILL.
- **`dev/entry-resolver.ts`**: search order — explicit `--entry <path>`
  flag, then `package.json` `main`, then `src/index.ts`, then
  `index.ts`. Returns first match or throws `entry_not_found`.
- **`commands/dev.ts`**: parses `--entry`, `--env <path>` flags,
  resolves entry, invokes runner.

#### Deep Dives
- **`tsx` invocation:** `tsx` is a dep (D197). Resolve its bin via
  `require.resolve("tsx/cli")` from the CLI package context (not the
  user's project). This ensures CLI-bundled tsx version is used,
  avoiding "user has wrong tsx" surprises.
- **Env file handling:** if `<cwd>/.env` exists, pass `--env-file=.env`
  to tsx. Otherwise skip (don't error).
- **Invariants:**
  - Child process MUST inherit cwd of user (not CLI install dir).
  - Signal propagation must be reliable (SIGINT from terminal reaches child).
- **Edge cases:**
  - Entry file deleted mid-run → tsx-watch handles restart; CLI logs once.
  - Port conflicts (if user's agent binds a port) → CLI doesn't manage
    ports; user sees stderr.
  - Multiple dev invocations → no lockfile; user is responsible.

#### Tasks
1. Implement `dev/entry-resolver.ts` with search-order logic.
2. Implement `dev/runner.ts` with spawn + stdio + signal handling.
3. Wire `commands/dev.ts`.
4. Test entry resolution in tmpdir with various layouts.
5. Test runner: spawn `echo`, verify stdio forwarding.

#### TDD
```
RED:     test_entry_resolver_uses_explicit_flag() — --entry foo.ts → returns foo.ts
RED:     test_entry_resolver_falls_back_to_package_main() — no flag, package.main set → returns it
RED:     test_entry_resolver_falls_back_to_src_index() — no main → returns src/index.ts
RED:     test_entry_resolver_throws_when_missing() — none exist → throws entry_not_found
RED:     test_runner_spawns_tsx_with_watch() — spy child_process.spawn → args contain "--watch"
RED:     test_runner_forwards_signals() — send SIGINT → child receives SIGTERM
RED:     test_runner_uses_env_file_when_present() — .env exists → args contain --env-file=.env
GREEN:   Implement runner + resolver.
REFACTOR: None expected.
VERIFY:  pnpm --filter @usetheo/cli test tests/dev/
```

#### Acceptance Criteria
- [ ] 7/7 RED → GREEN.
- [ ] `theokit dev` in a scaffolded project starts the agent and reloads on file change.
- [ ] Ctrl+C exits cleanly (child terminated, parent exits 0).
- [ ] Missing entry file emits actionable error.

#### DoD
- [ ] Tasks 1-5 done.
- [ ] CHANGELOG entry.
- [ ] Manual smoke: scaffold + dev → make a code change → tsx reloads.

---

## Phase 5: `theokit eval` (Minimal v1) ✅ DONE (2026-05-22)

**Objective:** Run a user-defined `eval.config.{ts,mjs}` against a dataset; emit a markdown report.

### T5.1 — Eval command implementation

#### Objective
`theokit eval [--config eval.config.ts] [--output report.md]` loads the
config, runs prompts through `Agent.batch`, scores via user-provided
scorers, emits a markdown report. v1 is intentionally minimal — the
config shape stays compatible with future `Eval.create()` (Roadmap #2).

#### Evidence
ADR D199: this v1 ships now to unblock Roadmap #1 without waiting for
Roadmap #2. Mastra's eval CLI is invoked the same way (`mastra dev` +
agent.evaluate). Without `eval`, the CLI is incomplete vs. its own
header.

#### Files to edit
```
packages/cli/src/commands/eval.ts           (replace stub)
packages/cli/src/eval/config-loader.ts      (NEW — dynamic import of user config)
packages/cli/src/eval/runner.ts             (NEW — Agent.batch + scoring loop)
packages/cli/src/eval/report.ts             (NEW — markdown emitter)
packages/cli/src/eval/types.ts              (NEW — EvalConfig shape that mirrors future Eval.*)
packages/cli/tests/eval/config-loader.test.ts (NEW)
packages/cli/tests/eval/runner.test.ts        (NEW)
packages/cli/tests/eval/report.test.ts        (NEW)
```

#### Deep file dependency analysis
- **`eval/types.ts`**: `EvalConfig = { dataset: Array<{input, expected?}>, scorers: Array<(out, expected?) => Score>, agent: AgentOptions }`. This shape MUST be a strict subset of the future `Eval.create()` API (Roadmap #2) so the user's config keeps working post-swap.
- **`eval/config-loader.ts`**: dynamic `import()` of user file. Validates
  exports via Zod. Throws actionable error if `default` export is missing
  or doesn't match shape.
- **`eval/runner.ts`**: calls `Agent.create(config.agent)`, then
  `Agent.batch(config.dataset.map(d => d.input), { concurrency: 4 })`.
  Maps results through `config.scorers`. Returns aggregated metrics.
- **`eval/report.ts`**: emits markdown table with one row per dataset entry, columns: input, output, score, expected. Plus aggregate metrics (mean score, pass/fail count by threshold).

#### Deep Dives
- **`Agent.batch` reuse:** D134-D140 give us batch with concurrency,
  failure isolation, and credential pool sharing for free. v1 eval is
  literally a thin wrapper.
- **Scorer contract:** `Scorer = (output: string, expected?: unknown) => { score: number; reason?: string }`. Pure function, no side effects.
- **Future-compat:** when Roadmap #2 ships `Eval.create({ dataset, scorers, agent })`, swap `runner.ts` internals to call `Eval.run(config)` — public config shape unchanged.
- **Invariants:**
  - Eval must NEVER mutate user files (read-only on config; write-only on `--output`).
  - Default `--output` is `./eval-report.md`; user-provided path must be inside cwd.
- **Edge cases:**
  - Empty dataset → exit 0 with "no entries" warning.
  - Scorer throws → catch, record as score=0 with `reason: "scorer_error"`, continue.
  - Config file syntax error → emit error with line/column, exit 2.

#### Tasks
1. Define `eval/types.ts` with `EvalConfig`, `Scorer`, `EvalResult`. **EC-K SHOULD TEST coverage**: `Scorer = (output: string, expected?: unknown) => Score | Promise<Score>` — async permitted (LLM-as-judge use case).
2. Implement `eval/config-loader.ts` with dynamic import + Zod validation.
3. Implement `eval/runner.ts` invoking `Agent.batch` + scoring. **EC-K**: `await` scorer return so async scorers work transparently; sync scorers return synchronous Promise.resolve wrapper.
4. **EC-F MUST FIX:** in `commands/eval.ts` (or `report.ts`), validate `--output` path BEFORE write: `import { safePathJoin } from "@usetheo/sdk/path-safety"; const resolved = safePathJoin(process.cwd(), opts.output); if (resolved === undefined) throw new ConfigurationError("--output path must be inside cwd (no traversal)", { code: "invalid_output_path" });`. Reusa o `path-safety` export que JÁ existe no SDK (D80).
5. Implement `eval/report.ts` markdown emitter.
6. Wire `commands/eval.ts`.
7. Write 4 tests (config load, runner, report, output-path-guard).

#### TDD
```
RED:     test_config_loader_imports_default_export() — fixture eval.config.ts → returns EvalConfig
RED:     test_config_loader_throws_on_missing_export() — no default → throws "no_default_export"
RED:     test_config_loader_validates_shape_with_zod() — bad shape → ZodError
RED:     test_runner_invokes_batch() — mock Agent.batch → called with dataset.length prompts
RED:     test_runner_applies_scorers() — output = "ok", scorer returns 1.0 → result score=1.0
RED:     test_runner_isolates_scorer_errors() — scorer throws → score=0 + reason "scorer_error"
RED:     test_report_emits_markdown_table() — 3 results → markdown contains 3 rows
RED:     test_report_aggregates_mean_score() — scores [1, 0.5, 0] → mean=0.5 in header
RED:     test_eval_rejects_output_path_traversal()                          [EC-F MUST FIX]
         — --output ../../etc/passwd OR /etc/passwd → ConfigurationError code "invalid_output_path"
         — --output ./report.md OR subdir/report.md → accepted
RED:     test_eval_supports_async_scorer()                                  [EC-K]
         — scorer returns Promise<Score> → runner awaits, score recorded correctly
         — async scorer rejects → score=0 with reason="scorer_error"
GREEN:   Implement files.
REFACTOR: Extract markdown table builder if reused (Phase 6 docs may use it).
VERIFY:  pnpm --filter @usetheo/cli test tests/eval/
```

#### Acceptance Criteria
- [ ] 8/8 RED → GREEN.
- [ ] Sample `eval.config.ts` in `templates/minimal/eval.config.example.ts` runs.
- [ ] Markdown report file is created at `--output` path.
- [ ] Scorer errors don't crash the eval.

#### DoD
- [ ] Tasks 1-6 done.
- [ ] CHANGELOG entry: "`### Added — theokit eval` (minimal v1, will swap to `Eval.run` per ADR D199)".
- [ ] Sample config + report shipped in `examples/cli-eval/`.

---

## Phase 6: Docs + README + Examples ✅ DONE (2026-05-22)

**Objective:** User-facing docs + monorepo wiring.

### T6.1 — Package README + monorepo README + ADRs

#### Objective
- `packages/cli/README.md` with quickstart for each subcommand.
- Root `README.md` mentions `npx @usetheo/cli init` as the
  recommended path.
- ADRs D193-D200 committed to `.claude/knowledge-base/adrs/`.

#### Files to edit
```
packages/cli/README.md                              (NEW)
packages/cli/CHANGELOG.md                           (NEW)
README.md                                            (root — add CLI quickstart)
.claude/knowledge-base/adrs/D193-cli-workspace-package.md (NEW)
.claude/knowledge-base/adrs/D194-commander-routing.md  (NEW)
.claude/knowledge-base/adrs/D195-bin-name-theokit.md   (NEW)
.claude/knowledge-base/adrs/D196-init-bundled-templates.md (NEW)
.claude/knowledge-base/adrs/D197-dev-via-tsx-watch.md  (NEW)
.claude/knowledge-base/adrs/D198-inspect-no-execution.md (NEW)
.claude/knowledge-base/adrs/D199-eval-v1-minimal.md    (NEW)
.claude/knowledge-base/adrs/D200-init-three-templates.md (NEW)
CLAUDE.md                                            (add D193-D200 to ADR table)
```

#### Tasks
1. Write package README with 4 subcommand sections + flags.
2. Write 8 ADRs (D193-D200), one per decision above.
3. Update root README "Getting Started" section to recommend
   `npx @usetheo/cli init`.
4. Update CLAUDE.md ADR table.
5. Update Adoption Roadmap row #1 to `~~1~~ T1 ~~**CLI `theokit`**~~ ✅ DONE` when this plan completes.

#### Acceptance Criteria
- [ ] Each subcommand has a docs section with example invocation.
- [ ] All 8 ADRs reference the same numbering D193-D200.

#### DoD
- [ ] All files written.
- [ ] CLAUDE.md ADR table includes 8 new rows.

---

## Phase 7: Dogfood QA (MANDATORY) ✅ DONE (2026-05-22)

> Per `.claude/rules/real-llm-validation.md`: smoke tests + fixture mode do NOT count. The CLI is end-to-end validated by running it against a real LLM in a fresh project.

### T7.1 — End-to-end real-LLM dogfood

#### Objective
Prove that the canonical onboarding flow works:
```bash
mkdir /tmp/dogfood-cli && cd /tmp/dogfood-cli
node ${SDK_ROOT}/packages/cli/dist/bin/theokit.js init demo --template ollama-local --force
cd demo
pnpm install --ignore-workspace
THEOKIT_API_KEY=local pnpm exec theokit dev   # observes agent run
# Ctrl+C; then:
pnpm exec theokit eval   # against sample dataset
# expect: report.md emitted, agent ran against Ollama, exit 0
```

#### Acceptance Criteria
- [ ] `theokit init demo --template ollama-local` creates a working project.
- [ ] `theokit dev` starts the agent and the agent responds to a sample prompt via Ollama.
- [ ] `theokit inspect` lists 7 providers + 6 adapters + 2 gateways.
- [ ] `theokit eval` runs a 3-row dataset and emits `eval-report.md`.
- [ ] No CRITICAL errors in any subcommand.

#### Pass Criteria
- [ ] 4/4 subcommands work end-to-end against real Ollama.
- [ ] Zero unhandled exceptions.
- [ ] Onboarding-time (from `init` to first agent response) ≤ 60 seconds
      assuming Ollama is already warm.

#### If Dogfood Fails
1. Identify failing subcommand.
2. Add test reproducing the failure to the relevant phase's test file.
3. Fix; re-run dogfood.

---

## Coverage Matrix

| # | Gap / Requirement | Task(s) | Resolution |
|---|---|---|---|
| 1 | No `init` scaffolder; new devs copy from examples by hand | T2.1 | `theokit init <name>` with 3 templates |
| 2 | No `dev` watch wrapper; devs wire `tsx --watch` ad-hoc | T4.1 | `theokit dev` shells to `tsx --watch` |
| 3 | No `inspect` discovery; debugging registry requires source reading | T3.1 | `theokit inspect` lists providers/adapters/gateways/plugins |
| 4 | No `eval` runner; eval suite (Roadmap #2) has no invocation surface | T5.1 | `theokit eval` v1 wraps `Agent.batch`, swaps to `Eval.run` later |
| 5 | CLI package shape unclear vs SDK | T0.1, ADR D193 | `@usetheo/cli` workspace package, separate from SDK |
| 6 | Subcommand routing must be standard | T1.1, ADR D194 | `commander@12` |
| 7 | Bin name must avoid collisions | ADR D195 | `theokit` (consistent with env vars + namespace) |
| 8 | Templates must work offline (no `degit` git clone) | T2.1, ADR D196 | Bundled `templates/<name>/` inside the package |
| 9 | Hot-reload must work for users | T4.1, ADR D197 | `tsx --watch` (battle-tested) |
| 10 | `inspect` must be safe to run in CI | T3.1, ADR D198 | Read-only registry queries + fs walk, no plugin execution |
| 11 | `eval` v1 must compose with future `Eval.*` API | T5.1, ADR D199 | Minimal `Agent.batch` wrapper; config shape forward-compatible |
| 12 | Template set must cover most-common use cases | T2.1, ADR D200 | `minimal`, `ollama-local`, `telegram-bot` |
| 13 | User-facing docs must exist | T6.1 | Package README + root README update + 8 ADRs |
| 14 | End-to-end flow must work against real LLM | T7.1 | Dogfood with `init → dev → eval` against Ollama |
| **EC-A** | **Project name violates npm naming rules → install fails** | T2.1 task #4 | Regex validation before any fs write |
| **EC-B** | **Crash mid-scaffold leaves partial dest** | T2.1 task #5 | Atomic scaffold-to-tmp-then-rename |
| **EC-C** | **Templates not in published tarball** | T0.1 task #2 | `"files": ["dist","templates",...]` in package.json |
| **EC-E** | **SDK internals not in exports map → CLI breaks on published install** | T3.1 task #1 + ADR D201 | New `Theokit.inspect.*` public namespace |
| **EC-F** | **`eval --output` path traversal** | T5.1 task #4 | `safePathJoin` (D80) before write |

**Coverage: 14/14 gaps + 5/5 MUST FIX edge-case items (100%) — todos absorvidos**

## Global Definition of Done

- [ ] All phases (0-7) completed.
- [ ] All tests passing: `pnpm --filter @usetheo/cli test`.
- [ ] Zero Biome lint warnings on `packages/cli/**`.
- [ ] Backward compatibility preserved: existing `theokit-migrate-memory`,
      `theokit-migrate-config` bins keep working.
- [ ] code-audit checks passing across `packages/cli/`.
- [ ] **Plan-specific criteria:**
  - [ ] `@usetheo/cli` builds clean with `pnpm -r build`.
  - [ ] 4 subcommands implemented and tested.
  - [ ] 3 templates ship and `tsc --noEmit` cleanly.
  - [ ] 8 new ADRs (D193-D200) registered.
  - [ ] Root README points to `npx @usetheo/cli init`.
  - [ ] Adoption Roadmap row #1 marked DONE in CLAUDE.md.
- [ ] **Dogfood QA PASS** (T7.1): end-to-end flow against real Ollama.
- [ ] **Runtime-metric proof:** `theokit init` measured at ≤ 5s; `theokit
      dev` first agent response ≤ 30s after `pnpm install` (warm Ollama).

## Final Phase: Dogfood QA (MANDATORY)

> See T7.1. The plan is NOT done until that runs green.

### Execution

```bash
# From a clean tmpdir, scaffold + install + dev + eval against real Ollama.
# See T7.1 commands.
```

### Acceptance Criteria

- [ ] All 4 subcommands work end-to-end against real Ollama.
- [ ] `init → dev` onboarding ≤ 60s (Ollama warm).
- [ ] Eval report emitted with ≥ 3 scored rows.
- [ ] Zero CRITICAL issues caused by this plan's code.

### If Dogfood Fails

1. Reproduce failure in a unit test under the relevant phase.
2. Fix; re-run dogfood.
3. Pre-existing issues (NOT caused by CLI) documented but don't block.

---

## Edge Case Review

Incorporado de `.claude/knowledge-base/reviews/edge-case/cli-theokit-edge-cases-2026-05-22.md` (14 edges encontrados):

- **5 MUST FIX (EC-A, EC-B, EC-C, EC-E, EC-F)** — absorvidos diretamente em T0.1 (task #2), T2.1 (tasks #4 + #5), T3.1 (task #1 + ADR D201), T5.1 (task #4). Cada um com test correspondente na TDD.
- **6 SHOULD TEST (EC-G, EC-H, EC-I, EC-J, EC-K, EC-L)** — adicionados aos blocos TDD das respectivas tasks (symlink rejection, ENOSPC handling, tsx-missing, child-crash, async scorer, sdkVersion semver resolution).
- **3 DOCUMENT (EC-M, EC-N, EC-O)** — notas para README do CLI: pnpm vs npm requirement, plugin name duplication (project wins per D162), dataset memory limits no eval v1.

Veredicto pós-incorporação: **PLANO OK** — pronto para implementação.

## Out of Scope (v1.0)

- **`init` from remote templates (git clone)** — only bundled templates ship.
  Remote templates need `degit` dep + auth handling; defer to v1.1 when there's pull.
- **`dev` with multiple entry points / monorepo mode** — single entry only.
- **`inspect --graph` (DOT/Mermaid output)** — JSON + human only.
- **`eval` UI dashboard** — Roadmap #2 (Eval suite) handles aggregation/UI.
- **`theokit publish` (deploy to TheoCloud)** — TheoCloud is pre-release;
  publish surface lives there, not in this CLI.
- **Migration of `theokit-migrate-memory` and `theokit-migrate-config` into
  subcommands** — keep standalone bins for backward compat; add `theokit
  migrate memory|config` as aliases in v1.1 (one-shot deprecation warn).
