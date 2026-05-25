# Changelog

## [Unreleased]

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
