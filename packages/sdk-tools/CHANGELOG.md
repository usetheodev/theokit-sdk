# Changelog

## 0.19.0

### Minor Changes

- `createSearchTextTool` gains two ADDITIVE, opt-in options (both default OFF ⇒ existing literal, project-
  scoped behavior unchanged): `regex` — match `query` as a JavaScript RegExp (grep semantics; an invalid
  pattern returns `{ ok: false, error: 'invalid_regex' }` before walking), and `allowAbsolute` — honor an
  absolute `path` scope outside `projectRoot` (Codex read-only "reads-anywhere"; forbidden dirs still
  skipped). Together they let one built-in cover both literal content search and grep-style regex search.

## 0.18.0

### Minor Changes

- `createReadFileTool` gains three ADDITIVE, opt-in Codex-grade capabilities (all default OFF, so existing
  consumers are byte-identical): `lineNumbers` (render a `cat -n` `<n>\t<line>` view so the model can cite/
  edit by line), `offset`/`limit` input params (page through a large file), and `allowAbsolute` (honor an
  absolute path outside `projectRoot` — the Codex read-only "reads-anywhere" sandbox). Security: with
  `allowAbsolute`, the secret guard now blocks `.env`/`.git`/`node_modules`/`.theo` at ANY path depth (not
  just the project-relative first segment), closing an absolute-path exfiltration hole. Opt-in only.

## 0.17.0

### Minor Changes

- c98c40a: Add `createUpdatePlanTool` — a Codex-faithful `update_plan` built-in. The model posts a DECLARATIVE plan
  (an ordered list of steps, each `pending | in_progress | completed`) and refreshes it as work proceeds.
  Surface-agnostic by design: returns STRUCTURED `{ ok, explanation, steps, warning? }` so each surface
  renders the checklist itself (no hard-coded glyphs). Follows Codex's "exactly one step in_progress"
  invariant as a non-fatal `warning` (never rejects), so the agent self-corrects on the next update.
  Distinct from the imperative `createTodolistTool` (add/complete by id) and `createPlanModeTool` (mode
  toggle) — this is the declarative full-plan post.

## 0.16.0

### Minor Changes

- ef00db3: Add `createCurrentTimeTool` — a built-in `current_time` tool. Codex-faithful at the core (Codex's
  `clock.curr_time` returns UTC as `YYYY-MM-DD HH:MM:SS UTC`); this keeps that as the default and adds an
  optional IANA `timezone` (additive superset — omitted ⇒ UTC) plus an unambiguous `iso` instant. Returns
  `{ ok, current_time, iso, timezone }` or `{ ok: false, error: 'invalid_timezone' }`. The clock is
  injectable (`{ clock }`) so the tool is deterministic under test.

## 0.15.1

### Patch Changes

- 4c5bd35: M15 review fixes (injected fs path only; local path unaffected): (1) the backend directory walk in
  `glob_files`/`search_text` decides entry type via `stat` (which follows symlinks), so an in-boundary
  symlink cycle could recurse until PATH_MAX — now depth-capped so it terminates; (2) `edit_file`'s
  backend read mapped every failure to `not_found` — now only a genuinely missing file (`FileNotFoundError`)
  maps to `not_found`; any other read error (e.g. a directory, a permission error) propagates (fail-loud),
  matching the local path's ENOENT-only classification.

## 0.15.0

### Minor Changes

- 324835f: M15 — complete the surface-agnostic tool injection. `search_text`, `glob_files`, and `edit_file` now
  accept an optional `filesystem` (`FilesystemProvider`), joining `shell_exec`/`git_diff` (`sandbox`) and
  `interactive_shell`/`write_stdin` (`interactive`). When a backend is injected the recursive walk / read
  / backup / write go through it in project-relative path space (so the tool runs unchanged on a local
  disk, a cluster container, or a Tauri desktop); when omitted the local `fs` path is byte-identical to
  before. Backward compatibility is proven by conformance tests that run each tool through the real
  `LocalFilesystem`/`LocalSandbox` backends and assert identical output to the local path. Additive — no
  breaking change.

## 0.11.1

### Patch Changes

- 453ad2d: SE43 — system-design audit fixes (public-surface changes).

  - **`@theokit/sdk` (minor):** the shared persistence kernel is now reachable from the sanctioned public `@theokit/sdk/persistence` barrel — `withCwdMutex`, `sanitizeFts5Query`, and `PersistenceSchema` are added (joining `replaceFileAtomic` / `openSqliteResilient` / `atomicWriteText` / `atomicWriteJson`). The `@theokit/sdk/internal/persistence` export is now **deprecated**: it re-exports its full surface unchanged for one release (back-compat) and is scheduled for removal in a future major. No breaking change; existing imports keep working.
  - **Satellites (patch):** `sdk-tools` / `sdk-memory` / `sdk-cache` / `sdk-handoff` / `sdk-budget` tightened their `@theokit/sdk` peer-range floor from `>=1.7.0` to `>=4.0.0`, matching the v4-only surfaces they import (prevents a non-workspace install resolving an incompatible old sdk).

## 0.11.0

### Minor Changes

- SE38 (#119) — `createTodolistTool()` is now session-aware: it scopes its items by the
  run's `ctx.threadId`, so one tool object served to many sessions from a single process
  (the multi-tenant server shape) no longer leaks one session's list into another. When no
  `threadId` is present (single-session CLI usage) every call shares one default session, so
  existing behavior is unchanged. `handler` accepts an optional 2nd `ctx` argument and
  `getItems(threadId?)` is session-scoped — both additive/back-compatible.

## 0.10.0

### Minor Changes

- 2606c98: SE37 — Reasoning ergonomics. Ships `ReasoningTools.create()` (`think`/`analyze` scratchpad tools, from `@theokit/sdk` core, re-exported by `@theokit/sdk-tools`) and a lightweight `AgentOptions.reasoning?: boolean` flag. When `reasoning: true`, the agent gets a chain-of-thought preamble prepended to its system prompt AND the reasoning tools auto-attached, turning a non-reasoning model into a reason→act→observe loop using the SAME model (reuses the existing tool loop; no new runtime). Inert (with a one-time warn) when a native reasoning model is configured (`model.params: [{ id: "thinking" }]`) — native reasoning wins, no double-reasoning. Default off; byte-identical behaviour when unset. Validated REAL on OpenRouter: `reasoning: true` drove the `think` tool and answered the "9.11 vs 9.9" trap correctly (9.9).

## 0.9.1

### Patch Changes

- 9dc221b: SE31 gap closure — wire the read-side file factories to the optional `filesystem` backend. `createReadFileTool` and `createListDirTool` now accept the same optional `filesystem` provider as `createWriteFileTool`, so a per-request / multi-tenant root isolates READS and LISTINGS too (previously only writes routed through the backend). Omitted ⇒ identical current behavior (local process fs). `createGlobTool` / `createSearchTextTool` remain on local fs in v1 — they need recursive traversal the minimal non-recursive `FilesystemBackend` seam does not expose (deferred follow-up).

## 0.9.0

### Minor Changes

- 3af329f: **SE31 — `Filesystem` provider seam (`@theokit/sdk/filesystem`).**

  A pluggable filesystem _storage_ provider, the storage-side twin of `@theokit/sdk/sandbox`. `FilesystemBackend` is an abstract class with four methods (`readFile` / `writeFile` / `stat` / `list`), an `exists()` derived on the base, a boundary `basePath`, a `readOnly` flag, structured `stat().mtimeMs` (the read-before-write oracle for SE32), and typed errors (`FileNotFoundError` / `FilesystemSecurityError` / `FilesystemReadOnlyError` / `StaleFileError`). `LocalFilesystem` is the local-process implementation, boundary-enforced by reusing the core path-guard (traversal + symlink escape → `FilesystemSecurityError`). `FilesystemProvider` + `resolveFilesystem` support a per-request resolver `(ctx) => FilesystemBackend` for multi-tenant roots.

  Unlike `SandboxBackend` (whose file ops shell out via `execute`, require command execution, and give no structured `stat`), a `FilesystemBackend` serves a filesystem-only workspace with no sandbox — see ADR 0011 for why file ops are NOT routed through `SandboxBackend`. `@theokit/sdk-tools`' `createWriteFileTool` now accepts an optional `filesystem` backend (writes route through it; omitted ⇒ identical local-`projectRoot` behavior). This is the backend seam, NOT a bundled `Workspace` and NOT a new toolset — bring-your-own-tools stands; `mounts`/FUSE, S3/GCS, and LSP remain out of core. (SDK Evolution roadmap SE31.)

- 84df83a: **SE32 — read-before-write safety (`requireReadBeforeWrite` + `ReadTracker`).**

  An opt-in guard on `createWriteFileTool` that refuses to blindly overwrite a file the agent has not seen. A per-run `ReadTracker` (exported from `@theokit/sdk-tools`) records each file's mtime when `createReadFileTool` reads it; when `createWriteFileTool` is created with `{ requireReadBeforeWrite: true, readTracker }`, a write is refused with `read_required` if the existing file was never read, or `stale_file` if it changed on disk since it was read. A NEW file writes freely (nothing to clobber). Default OFF — omitting the flag preserves current behavior exactly.

  Works on both the local `projectRoot` path and the SE31 `filesystem` backend path (the backend also gets `expectedMtime` forwarded so it re-checks at write time — TOCTOU defense). The tracker is deliberately per-instance, not a global singleton, so state never leaks across runs. `edit_file` already has implicit read-before-write safety via `old_string` content matching, so the guard targets the blind-overwrite path (`write_file`). Refusals surface as `FileReadRequiredError` / `StaleFileError`. (SDK Evolution roadmap SE32.)

## 0.8.0

### Minor Changes

- ac3f77d: @theokit/sdk: resolveModelCapabilities catalog gains cheap OpenRouter slugs (qwen3-coder, deepseek v4-flash/v3.2, glm-4.7-flash, gemini-2.5-flash-lite/pro) so they resolve real context windows instead of the 4096 default. @theokit/sdk-tools: new createGenericHttpSearchAdapter (env-keyed generic HTTP WebSearchCallback alongside Brave); buildEnvContext gains git-branch detection + an injectable clock. @theokit/sdk-cache: ships createLexicalEmbedder (zero-dependency token-hash lexical embedder built-in).

## 0.7.0

### Minor Changes

- 5bd2f9c: @theokit/sdk: `shouldCompact`/`ShouldCompactInput` gains an optional `maxOutput` output-reserve term (`estimated >= contextWindow - buffer - (maxOutput ?? 0)`), defaulting to today's behavior. `AgentOptions.plugins` now also accepts an array of code `Plugin` objects (matching the runtime + docs), not only `{ enabled }`. @theokit/sdk-tools: `renderToolList` gains an optional `{ mode: "full" | "summary" | "names" }` — `"full"` (default) is the existing `<tools>` XML; `"summary"` renders `- name: <first sentence>`; `"names"` renders `- name`.

## 0.6.0

### Minor Changes

- 6d65983: `createWebFetchTool` gains a redirect policy + injection seam.

  - **`maxRedirects?: number`** — caps redirect hops (each SSRF-screened). Default 5 (unchanged). Set `0` to BLOCK ALL redirects (strict no-redirect policy for untrusted, model-chosen URLs).
  - **Distinct `redirect_blocked` error** — a refused redirect now returns `{ ok:false, error:'redirect_blocked' }`, split from `ssrf_blocked` (a blocked private/reserved host). New exported `RedirectBlockedError`; `screenedFetch` throws it on redirect-limit exhaustion (was `SsrfBlockedError("too many redirects")` — a minor, more-precise error refinement).
  - **Injectable `fetchImpl?` / `lookup?`** — drive the tool's redirect + SSRF paths deterministically in tests with no real network/DNS (the seam `screenedFetch` already had, now on the tool surface).

  Additive + backward-compatible: absent options ⇒ today's behavior; `ssrf_blocked`/`invalid_url`/`timeout`/`too_large` codes + return shape unchanged. Lets a consumer (theocode) replace an app-side SSRF/redirect wrapper with `createWebFetchTool({ maxRedirects: 0 })`.

## 0.5.0

### Minor Changes

- 6dc0e26: Add `withShellExitGuidance` — a guidance wrapper for `shell_exec` soft failures.

  `injectGuidance`/`withDefaultGuidance` inject an actionable `guidance` hint only on `{ ok:false, error }` results (by design). But `shell_exec` returns `{ ok:true, exit_code }` — a non-zero `exit_code` is a SOFT failure (the tool ran, the command failed) that the ok:false-only injector does not cover. `withShellExitGuidance(tool)` wraps `shell_exec` so a `{ ok:true, exit_code≠0 }` result gains a `guidance` hint ("The command exited N. Read the stderr above, fix the cause, then retry."). ADDITIVE, IDEMPOTENT, NEVER-THROW; a no-op for any other tool, for `exit_code 0`, and for non-JSON output. Composes after `withDefaultGuidance` (disjoint domains — no double-injection). Lets consumers drop app-side shell-exit guidance reimplementations.

## 0.4.0

### Minor Changes

- bd10da3: SOTA default descriptions for the 9 built-in tools (`read_file`/`write_file`/`edit_file`/`glob_files`/`search_text`/`shell_exec`/`todolist`/`web_fetch`/`web_search`).

  Each tool's default `description` is upgraded from terse mechanics-only copy to rich, behavior-accurate ACI copy (preconditions, when-to-prefer-which-tool, return shape) — the Agent-Computer Interface the model reads to choose tools, which measurably improves tool-selection. Every claim is verified against the tool's own handler (e.g. `search_text` is described as LITERAL + CASE-SENSITIVE because it matches via `line.includes`; `web_fetch` is described as SSRF-guarded because `screenedFetch` defaults `allowPrivateHosts: false`), so the description lives next to the implementation it describes and cannot drift. Descriptions are generalized (no app-specific cross-tool references). `edit_file` now also ENFORCES the documented `old_string !== new_string` precondition (a no-op edit returns `{ ok: false, error: "no_change" }` instead of a misleading `replacements: 1`), so the description matches behavior. Otherwise no API change: same factory signatures, same return shapes; only the default description string changed. Consumers no longer need to override these descriptions app-side — `withDescription` remains for genuine per-consumer customization. Added `tests/sota-descriptions.test.ts` asserting each description's load-bearing behavioral phrases.

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
