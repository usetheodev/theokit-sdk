# Changelog

## [Unreleased]

### Added (`theokit tasks` — observable async work registry, ADRs D361-D374)

- New top-level subcommand `theokit tasks {list|inspect|cancel}` reads the
  `JsonFileTaskStore` at `$THEOKIT_HOME/tasks/` (fallback: `cwd/.theokit/tasks`).
  Reports CLI exit codes: 0 success, 2 permission/IO, 3 invalid id grammar,
  4 task not found.
- `theokit tasks list [--state S] [--kind K] [--json]` — table or JSON view.
- `theokit tasks inspect <id> [--json]` — full handle dump.
- `theokit tasks cancel <id> [--reason R]` — cross-process best-effort cancel via
  the `cancelRequested` flag on the JSON-backed handle. The owning Node process
  (the one that submitted the task) honors the flag at the next checkpoint
  (EC-7). Queued tasks transition directly to `cancelled`. Terminal tasks
  print `task already terminal` and exit 0.
- 12 unit tests under `tests/commands/tasks.test.ts` covering fresh-install
  ENOENT (EC-6), invalid id grammar, not-found, and the 3 cancel paths.

### Added (`theokit acp` — ACP server adapter, ADRs D349-D360)

- New top-level subcommand `theokit acp` launches a stdio ACP server pointing at
  the entry file's default-exported `SDKAgent` or factory. Used by Zed,
  Cursor, Claude Desktop, and any [Agent Client Protocol](https://agentclientprotocol.com)
  host.
- `--entry <path>` reuses the same resolver as `theokit dev` (D357). Default:
  `src/index.ts` or `package.main`.
- `--permission ask|auto|deny` controls tool gate (default `ask`). `--trusted-tools`
  bypass list. `--permission-timeout-ms` overrides the 60 s default (EC-2 absorbed).
- CJS/ESM interop fallback (`mod.default ?? mod`) so consumers using
  `module.exports = factory` work without contortions (EC-4).
- `@usetheo/acp` listed as an OPTIONAL peer dependency — install only when you
  need the subcommand: `npm i @usetheo/acp`.
- 4 new tests in `tests/commands/acp.test.ts` covering entry resolution, default
  export fallback, permission flag validation.

### Added (Roadmap v1.4 #5 — `theokit setup gworkspace`, ADRs D340-D348)

- New top-level subcommand `theokit setup <domain>` (ADR D346) with `gworkspace`
  as the first concrete domain. Future domains follow the same pattern.
- `packages/cli/src/commands/setup.ts` + `packages/cli/src/setup/gworkspace.ts` —
  walkthrough that validates `~/.google-mcp/credentials.json` BEFORE delegating
  to upstream `npx google-workspace-mcp setup` + `accounts add`.
- EC-1 (MUST FIX): rejects Web-type OAuth client up-front with actionable error.
- EC-2: rejects malformed JSON with parse-error message.
- EC-3: `--probe` mode caps each upstream call at 10s.
- Path-traversal guard on `--credentials-path` (D80 pattern).
- 8 new tests in `tests/setup/` (credentials-check + dispatch).

### Added (T0.1 — workspace scaffolding, Adoption Roadmap #1)

- New workspace package `@usetheo/cli` — developer CLI for `@usetheo/sdk`.
- `bin: theokit` registered; executable shim at `src/bin/theokit.ts`.
- Programmatic API: `main(argv): Promise<number>` returns exit code.
- Build-time constants `SDK_VERSION` / `CLI_VERSION` injected via tsup
  `define` (EC-L fix — never `workspace:*` in scaffolded projects).
- `"files": ["dist", "templates", "README.md", ...]` in package.json
  (EC-C MUST FIX — ensures templates ship in the published tarball).
- Smoke tests + tarball-contents guard.

Subcommand surface (`init`, `dev`, `inspect`, `eval`) ships in T1.1-T5.1.
