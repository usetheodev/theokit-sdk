# Changelog

## [Unreleased]

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
