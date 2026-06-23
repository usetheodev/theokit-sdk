# Changelog

## 0.3.0

### Minor Changes

- 986f340: V3-1 — harden `catastrophicShellReason` to theocode's security-reviewed shell-guard. The `shell_exec` guardrail previously missed 18 of 42 catastrophic commands (empirical probe): `git reset --hard`, `git clean -fd`, secret-file exfiltration (`cat .env | curl`, `tar ~/.aws | nc`), command-substitution / eval RCE (`eval "$(curl)"`, `. <(curl)`, `bash -c "$(curl)"`), `find / -delete` / `-exec rm`, `truncate /dev/sda`, and a range of `rm -rf` targets (`~/sub`, `/usr/local`, `../..`, `$HOME/x`, flags after the operand, any absolute non-scratch path). The rules are ported from theocode's hardened guard (proven by a 42-blocked + 24-allowed corpus at 0 misses / 0 false-positives) as a SUPERSET — the SDK's extra screens (recursive `chmod`/`chown` on a root path, extra block-device families, `//` collapse) are kept, and the segment splitter now also covers `&` and newlines. Reason strings widened to describe each category; the public API (`catastrophicShellReason(cmd): string | null`, `CatastrophicCommandError`) is unchanged. No new dependency.

## 0.2.0

### Minor Changes

- b392b02: M3-5 — ACI description override + render `<tools>` (plan `m3-aci-tools`).

  Two pure, zero-dependency ACI helpers in `@theokit/sdk-tools`:

  - `withDescription(tool, description)` — returns a new `CustomTool` with the LLM-facing description replaced (name/inputSchema/handler preserved); the original tool is not mutated. Tune a built-in tool's wording without re-implementing it.
  - `renderToolList(tools)` — renders a `<tools>` block (name + description per tool) from the SAME `CustomTool[]` the agent runs, so the list cannot drift from the real tools (single source of truth). XML-escaped, empty-safe (`<tools></tools>`), never throws. It is a system-prompt orientation aid — the provider schema stays each tool's `inputSchema`.

  Zero new dependencies.

- 9a7ab99: M3-2 — catastrophic-command guardrail for `shell_exec` (secure by default; plan `m3-catastrophic-shell`).

  `createShellTool()` now screens every command against a segment-aware deny-list **by default**. A command that, in any segment (across `;`/`&&`/`||`/pipe chains, behind `sudo`/`env`, or piped into a shell), matches a catastrophic pattern returns `{ ok: false, error: "catastrophic_command", reason }` instead of executing. The screened set: `rm -rf` of a root/home/glob or top-level system-dir target (`/`, `~`, `$HOME`, `/etc`, `/usr`, … — relative paths like `./build` stay allowed), `curl`/`wget` piped into `sh`/`bash`, `mkfs`, `dd` writing to a device, the `:(){ :|:& };:` fork bomb, `git push --force` (including the `+refspec` form; `--force-with-lease` allowed), `chmod`/`chown -R` on a root path, and redirects to a block device. Matching is at COMMAND POSITION (the executable, not an arbitrary substring), so a mention like `echo "rm -rf /"` is not over-blocked.

  **Behavior change:** agents running catastrophic commands now get `catastrophic_command`. Opt out for legitimate destructive power flows with `createShellTool({ allowCatastrophic: true })`.

  This is a heuristic GUARDRAIL, not a sandbox — it is bypassable by obfuscation and is POSIX-only (Windows PowerShell out of scope). Also exports the reusable primitives `catastrophicShellReason` and `CatastrophicCommandError`. Zero new dependencies (in-house segment tokenizer).

- 51bf3ae: M3-6 — composable command-permission policy layer (plan `m3-command-policy`).

  A small, pure, zero-dependency policy layer that builds on the `shell_exec` catastrophic guardrail (M3-2):

  - `type CommandPolicy = (command) => string | null` — a deny reason, or `null` to allow.
  - `denyCatastrophicCommands()` — a policy composing `catastrophicShellReason` (no duplicated deny-list).
  - `commandDenialReason(command, policies)` — first deny reason across the array (deny-wins); `null` if all allow; an empty array denies nothing.
  - `isCommandAllowed(command, policies)` — the boolean view.

  Framework-agnostic — wire it at your permission layer (e.g. inside a `pre_tool_call` hook). Inherits the guardrail's honesty (a heuristic gate, not a sandbox). Zero new dependencies.

- 6ef9eae: M3-3 — repo-map / env-context builders (plan `m3-repo-map`).

  `@theokit/sdk-tools` now exports two `node:fs`-only, char-bounded, **never-throw** string builders that orient an LLM coding agent in one call:

  - `buildEnvContext(cwd)` — an `<env>` block: working directory, platform/arch, Node version, is-git (detected via the presence of `.git`, no `git` subprocess), today's date, project docs found (`AGENTS.md`/`CLAUDE.md`/`README.md` with a bounded head), and detected manifests.
  - `buildRepoMap(cwd, { budget, ignore, maxDepth })` — a depth-first directory tree bounded by `budget` (default 8000 chars, `… (truncated)` marker), `maxDepth` (default 4), and a per-directory cap. Default ignores (`node_modules`/`.git`/`dist`/`.theo`/`.next`/`build`/`coverage`/`target`/`out` + dot-entries) merge with the caller's `ignore`. Directory symlinks are listed as leaves (not followed) so symlink loops cannot hang the walk.

  Both NEVER throw — a missing/unreadable path yields an `(unavailable)` marker; an unreadable sub-directory is skipped. A best-effort orientation aid (not a complete or `.gitignore`-aware listing — deferred). Zero new dependencies (`node:fs`/`node:path` only).

- 5c40feb: M3-4 — rich tool errors / self-correction guidance (plan `m3-rich-errors`).

  `@theokit/sdk-tools` now exports a composable wrapper that adds an LLM-actionable `guidance` hint to a failing tool result so the model can self-correct:

  - `withToolResultGuidance(tool, guidance)` — wraps any `CustomTool`; on an `{ ok:false, error }` result it adds a `guidance` string from the `guidance` map (keyed by error code), preserving name/description/inputSchema.
  - `withDefaultGuidance(tool)` — pre-bound to `DEFAULT_TOOL_GUIDANCE`, a curated map for the common codes (`not_found`, `path_traversal`, `forbidden_path`, `no_match`, `timeout`, `invalid_url`, `ssrf_blocked`, `catastrophic_command`, `binary_file`, `too_large`).
  - `injectGuidance(output, guidance)` — the pure underlying transform.

  Injection is ADDITIVE (only on `ok:false`), IDEMPOTENT (never overwrites existing `guidance`), and NEVER-THROW: non-JSON output, `ok:true`, non-object JSON, or an unknown code is returned unchanged. Compose over the built-in tools or your own — no factory edits. Zero new dependencies.

- f7f67d0: M3-1 — SSRF guard for `web_fetch` (secure by default; plan `m3-ssrf-guard`).

  `createWebFetchTool()` now screens every request and every redirect hop against an SSRF block-list **by default**. A URL whose host resolves to a private/loopback/link-local/CGNAT/cloud-metadata/reserved address (IPv4 or IPv6, including IPv4-mapped `::ffff:` and DNS names resolving to such) returns `{ ok: false, error: "ssrf_blocked" }`. Redirects use `redirect:"manual"` with per-hop re-screening (a redirect to `127.0.0.1`/`169.254.169.254` is blocked, not followed); non-http(s) redirect targets are rejected. Resolves ALL A-records (multi-record evasion) and unwraps IPv4-mapped IPv6.

  **Behavior change:** requests to localhost/private hosts are now blocked. Opt out for trusted local-dev tooling with `createWebFetchTool({ allowPrivateHosts: true })`.

  Also exports the reusable screening primitives `resolveAndScreen`, `isBlockedIp`, `screenedFetch`, and `SsrfBlockedError`. Node `dns`/`net` builtins only — zero new dependencies.

- 30ad16e: M3-7 — Brave web-search provider adapter (plan `m3-websearch-adapter`).

  `createWebSearchTool` is provider-agnostic; `@theokit/sdk-tools` now ships one concrete env-driven adapter:

  - `createBraveWebSearchAdapter({ apiKey?, fetchImpl?, endpoint? })` — a `WebSearchCallback` backed by the Brave Search API. The key defaults to `process.env.BRAVE_API_KEY` (throws a typed `ConfigurationError` code `no_api_key` at creation if absent — fail-early). `fetchImpl` is injectable (default `globalThis.fetch`) for offline testing. Maps Brave's `web.results[]` to `{ title, url, snippet }` (empty-safe); a non-ok HTTP response throws, which `createWebSearchTool` surfaces as `{ ok:false, error:"search_failed" }`.

  Plug it in with `createWebSearchTool({ search: createBraveWebSearchAdapter() })` — the tool stays provider-agnostic (additional providers like Tavily are a follow-up). Uses a plain `fetch` (the endpoint host is fixed; no SSRF surface). Zero new dependencies.

- 0fe0f28: M4-4 — generic session artifact store + opt-in plan-mode persistence (plan `m4-artifact-store`).

  - `createSessionArtifactStore({ dir, idStrategy?, extension? })` → `{ write, read, has, list, path }`. A generic, id-keyed, atomic artifact store generalizing the per-run session-summary writer. `write(id, content)` persists `<dir>/<idStrategy(id)><extension>` via `replaceFileAtomic` and returns the path; `read` returns the content or `undefined` (never throws); `has`/`list` enumerate; `path(id)` is traversal-safe. Default `idStrategy` is `safeFilenameForId` (+ `safePathJoin`), so a `../escape` id can never write outside `dir`. Reads never throw; writes fail loud. Zero new dependencies.
  - `createPlanModeTool({ artifactStore, artifactId? })` — a new OPT-IN overload whose async handler persists the submitted `plan` to the store on `exit` (returns `{ ok, mode, message, persisted, path }`). The zero-arg `createPlanModeTool()` is unchanged (synchronous handler, no disk). Only a non-empty `plan` on `exit` is persisted; `enter`/`status` never write.

- 0d07f29: M4-5 — `todolist` structured items (latent bug fix) + `todoItemsToPlanNodes` adapter (plan `m4-todo-plan-nodes`).

  - **Fix:** the `todolist` tool returned only a formatted `items_summary` STRING — never the structured `items` array — so a consumer parsing the result to render a plan/UI always recovered `[]`. Every list-bearing result now ALSO carries `items: TodoItem[]` (a snapshot copy), alongside the preserved `items_summary`. `getItems()` + error/`fail` shapes are unchanged.
  - **Add:** `todoItemsToPlanNodes(items: readonly TodoItem[]): PlanNode[]` — a versioned, pure adapter mapping each item to `{ id, label: title, status }` (timestamps dropped, order preserved) + the `PlanNode` type. Replaces consumer-side hand-rolled mappers.

  Zero new dependencies.

All notable changes to `@theokit/sdk-tools` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

(No unreleased changes.)

## [0.1.0] — 2026-06-08

### Added

- Initial extraction from `@theokit/sdk@1.7.0` `src/tools/` directory.
- Public factories:
  - `createReadFileTool({ cwd })`
  - `createListDirTool({ cwd })`
  - `createSearchTextTool({ cwd })`
  - `createGitDiffTool({ cwd })` — requires `simple-git` peer
  - `createRunVitestTool({ cwd })` — requires `vitest` peer
  - `createSubprocessTool({ cwd })`
- Path-scope helpers: `checkPathScope`.
- Security: inline `isForbiddenPath` blocklist primitive (avoid coupling to `@theokit/sdk/internal/security`).
- Peer-deps: `@theokit/sdk@>=1.7.0`, optional `simple-git` and `vitest`, `zod@^3.25.0 || ^4.0.0`.

### Notes

- `@theokit/sdk/tools` sub-path is removed in `@theokit/sdk@2.0.0`; consumers move to `@theokit/sdk-tools`.
- All 6 unit tests from `packages/sdk/tests/tools/{git-diff,list-dir,read-file,run-vitest,search-text,sub-export-smoke}.test.ts` migrated.
- Sub-export smoke test rewritten to assert the new package barrel surface.
