# Tool built-in contract (`@theokit/sdk-tools`)

How a built-in tool stays **surface-agnostic** (terminal / desktop-Tauri / web-cluster) and
**consistent** across the kit. Followed by `read_file` (filesystem), `interactive_shell` +
`write_stdin` (interactive), and every future built-in.

## 1. Naming

- `snake_case`, verb-first where it reads naturally (`read_file`, `write_stdin`, `search_text`).
- A host may re-expose a built-in under another name with **`withName(tool, name)`** — a single impl
  behind both names (e.g. a Codex-style agent aliases `search_text` → `grep`). Never fork the impl.

## 2. Output shape

- Handlers **return a JSON string**, never throw on a user mistake:
  `{ ok: true, ... }` or `{ ok: false, error: '<stable_code>' }`. Real bugs (SDK-side) throw.
- `error` codes are **stable identifiers** (`no_match`, `interactive_unavailable`, `no_such_session`,
  `path_traversal`, …), not prose — the prose lives in the description.

## 3. Injected backends (DIP — the surface-agnostic rule)

A tool that touches an execution environment MUST depend on an **injected backend interface**, never a
concrete native primitive:

| Capability | SDK interface (`@theokit/sdk/…`) | Resolver | Local impl |
|---|---|---|---|
| Filesystem | `/filesystem` `FilesystemProvider` | `resolveFilesystem(p, ctx)` | `LocalFilesystem` |
| One-shot exec | `/sandbox` `SandboxBackend` | — | `LocalSandbox` (+ Docker/E2B) |
| Interactive session | `/interactive` `InteractiveProvider` | `resolveInteractive(p, ctx)` | `@theokit/sdk-pty` (opt-in) |

The tool factory takes the provider as an option and calls `resolve…(provider, ctx)` in the handler.
Native modules (e.g. `node-pty`) live ONLY in the concrete backend package, never in `sdk-tools` or
core — so the SAME tool runs on a local PTY, a cluster container (Docker/E2B), or a Tauri desktop by
injecting a different backend. Absent/failed backend → `{ ok: false, error: '<capability>_unavailable' }`.

**Injection status of the built-ins** (the injected option is always OPTIONAL — omitted ⇒ the local
path is byte-identical to before; conformance tests prove it):

| Tool | Option | Injected capability |
|---|---|---|
| `read_file` / `list_dir` / `write_file` | `filesystem?` | `FilesystemProvider` |
| `search_text` / `glob_files` / `edit_file` | `filesystem?` | `FilesystemProvider` |
| `shell_exec` / `git_diff` | `sandbox?` | `SandboxProvider` |
| `interactive_shell` / `write_stdin` | `interactive?` | `InteractiveProvider` |

## 4. Description (the DX contract)

The description is the ONLY thing the model reads. It MUST: be non-trivial (≥ ~60 chars); state what the
tool RETURNS (shape in prose — tools return strings); and surface every constrained numeric bound in
prose (the model never sees the Zod schema).

## 5. Conformance tests

Every built-in ships tests that: exercise the happy path against a **fake/in-memory backend** (no native
dep in CI); assert each `{ ok: false, error }` branch; and (for aliasable tools) assert alias parity
(`withName`-aliased tool runs the same handler). Backend packages add real-integration tests, skipped
when the native module is absent.
