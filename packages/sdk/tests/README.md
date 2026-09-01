# Test layer taxonomy

This directory has no automated unit/integration split — `pnpm test` (via
`vitest.config.ts`) runs everything under `tests/**/*.test.ts` in one gate, minus
the files named in `ROADMAP_ONLY_SUITES`. Nothing in this repo reads a "layer"
label at run time: there is no `test:unit` / `test:integration` script, no vitest
`projects` split, and no in-repo classifier. The only place a `layer` tag has
existed is a one-off snapshot in an external audit tool's database
(`.claude/knowledge-base/audits/test-pyramid-2026-08-18/test-pyramid.db`), which
this repo does not consume.

Given that, this file — not a metadata flag nobody reads — is the source of
truth for which directories cross a real boundary, so a human (or a future
classifier) has one place to check instead of re-deriving it per audit.

## Where a new test file goes

There is a rule now, because for a long time there was not one and the tree recorded the absence:
251 loose `*.test.ts` files sat at `tests/` beside 34 topic directories, and **52 of them contradicted
that taxonomy by their own name** — 15 `tests/memory-*.test.ts` while `tests/memory/` held 2,
12 `tests/agent-loop-*` while `tests/agent-loop/` held 4, and so on for mcp, server, workflow, llm,
errors, security, sandbox and internal. A contributor who opened the obvious directory found a
minority of the relevant tests and had no way to learn the rest lived one level up. Those 52 were
moved into the sibling directory their name already named.

The rule, in one line: **a test named after a directory belongs in it.**

| The test exercises… | It lives at | Why |
|---|---|---|
| a published `exports` subpath of `package.json`, as a consumer meets it | `tests/<name>.test.ts` (root) | the root mirrors the public surface, so the contract tests sit where the contract does |
| a subsystem that has a directory (`memory`, `mcp`, `agent-loop`, `server`, `workflow`, `llm`, `errors`, `sandbox`, `security`, `internal`, …) | `tests/<subsystem>/<rest>.test.ts` | one place to look, and `vitest run tests/<subsystem>` is a usable command |
| a repo-wide invariant, not a subsystem (lint rules, architecture checks) | `tests/lint/`, `tests/architecture/` | they assert about the repository, not about a module |

The root placement is **legitimate and deliberate** for the first row — this is not a directory that
wants to be empty. What it must not hold is a file whose name announces a directory that exists.

Naming: once a file is inside `tests/<subsystem>/`, the prefix is redundant and is dropped —
`tests/memory-fact-kind.test.ts` became `tests/memory/fact-kind.test.ts`, not
`tests/memory/memory-fact-kind.test.ts`.

## Directories that cross a real I/O boundary (integration-tier)

These run fast enough to sit in the same gate as unit tests, but they are not
unit tests: each one crosses at least one real boundary (filesystem, a spawned
child process, or a real PTY). Per `rules/testing.md` § 4.1, a test that does
real I/O is an integration test regardless of how quickly it runs.

| Directory / file | Boundary crossed | Via |
|---|---|---|
| `tests/contract/**/*.contract.test.ts` | Real filesystem (mkdtemp + fixture copy + writes) | `tests/helpers/temp-workspace.ts` → `createTempWorkspace()` |
| `tests/golden/agent-run.golden.test.ts`, `catalog-cron-artifacts.golden.test.ts`, `platform-extensions.golden.test.ts`, `stream.golden.test.ts` | Real filesystem | `createTempWorkspace()` |
| `tests/symlink-containment.test.ts` | Real filesystem (symlinks under a real temp dir) | `createTempWorkspace()` |
| `tests/mcp/session-lifecycle-pid.test.ts`, `client-timeout.test.ts`, `client-env-scrub.test.ts`, `client-reconnect.test.ts`, `initialize-after-failed-handshake.test.ts` | Real child process (stdio MCP server) | `createMcpClient()` with a real `command` (`node`/`sh`) |
| `tests/golden/mcp/real-client.golden.test.ts` | Real child process | `createMcpClient()` with `command: process.execPath` |
| `../sdk-pty/tests/max-sessions.test.ts` | Real PTY | `PtyInteractiveBackend` |
| `../sdk-pty/tests/pty-interactive-backend.test.ts` — the `"PtyInteractiveBackend (real PTY)"` describe block only (7 of its 10 cases; the sibling `"clampYield (pure)"` block is a genuine pure-function unit test and is NOT integration) | Real PTY | `PtyInteractiveBackend`, gated behind `probe.available() ? describe : describe.skip` when the native build is absent |

**Not** on this list, despite superficially matching the same grep pattern
(`command: "node"` / `mcp` / `pty`), because they were checked individually and
do not cross the boundary for real:

- `tests/mcp/pool.test.ts`, `tests/mcp/lifecycle-wiring.test.ts`,
  `tests/mcp/run-ownership.test.ts` — pass an identical-looking config to a fake
  factory; never spawn.
- `tests/golden/agent/cloud-payload-serializer.golden.test.ts`,
  `tests/golden/agent/cloud-tool-parity.golden.test.ts` — only serialize such
  configs.
- `../sdk-pty/tests/wrap-command-seam.test.ts` — mocks the `node-pty` module.
- `tests/internal/runtime/validate-agent-options.test.ts` — validates the shape
  of an `mcpServers` config object; never constructs a client.
- `tests/contract/mcp.contract.test.ts`, `tests/contract/hermes-parity.contract.test.ts`
  — already listed above under the filesystem row (they use
  `createTempWorkspace()`); their MCP config does not add a second boundary
  worth a separate row.

## Provenance

- Filesystem-boundary row: B-040.
- Process/PTY-boundary rows: B-041. `client-reconnect.test.ts` and
  `initialize-after-failed-handshake.test.ts` were added to this table on
  2026-08-20 — the original `/loop-test-pyramid` audit (2026-08-18) flagged 6
  files in this class and missed these two, which sit in the same
  `tests/mcp/` directory and call the same real `createMcpClient()` factory
  with a real `command`.

## Why this stops at documentation

Reclassifying these files in the audit tool's own database would falsify a
historical snapshot rather than fix a live gate — nothing re-reads that
database after the audit that produced it. If a `layer` split is ever wired
into this repo (a vitest `projects` config, a `pnpm test:unit` script), that
work should treat this table as its starting input rather than re-deriving it.
