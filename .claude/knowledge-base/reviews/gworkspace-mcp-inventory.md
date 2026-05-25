# Google Workspace MCP Inventory — Phase 0

Data: 2026-05-25
Plan: `skills-google-workspace-plan.md`
Decision: **Pivot the plan** from "3 separate MCP servers" to **1 combined MCP server**: `google-workspace-mcp@2.3.6` (pm990320).

## Why we pivoted

The plan v1.1 listed three independent MCP servers (Calendar / Drive / Sheets). Phase 0 inspection revealed:

1. The "official" Anthropic Drive server (`@modelcontextprotocol/server-gdrive`) is **stale** — last release `2025.1.14` (≥ 16 months without code changes). Violates the global criterion "Last release < 6 months" (`~/.claude/CLAUDE.md` §9).
2. The reference implementation in Hermes (`referencia/hermes-agent/skills/productivity/google-workspace/`) does **NOT** consume MCP servers; instead it wraps the official `google-api-python-client` directly. This proves the "3-MCP-servers" assumption was speculative.
3. A combined community server with broad coverage AND recent maintenance AND trusted publisher signal exists: `google-workspace-mcp@2.3.6`.

## Decision matrix

Per-criterion scoring (each row 0–3; total 0–18). Reject any candidate scoring < 12 or with non-permissive license.

### Combined candidates

| Criterion | `google-workspace-mcp` (pm990320) | `@aaronsb/google-workspace-mcp` | `@dguido/google-workspace-mcp` |
|---|---|---|---|
| Maintenance recency | 3 (2026-04-03, < 2 months) | 3 (2026-05-11) | 2 (2026-02-22) |
| License | 3 (MIT) | 0 (not declared on npm) | 3 (MIT) |
| Publisher trust | 3 (GitHub Actions OIDC trusted publisher) | 1 (single maintainer) | 2 (Trail of Bits security firm) |
| Tool coverage | 3 (95+ tools — Docs, Sheets, Drive, Gmail, Calendar, Slides, Forms) | 3 (similar coverage advertised) | 2 (Drive, Docs, Sheets, Slides, Calendar, Gmail) |
| Scope discipline | 3 (built-in `--read-only` mode + `accounts test-permissions`) | unverified | unverified |
| OAuth / setup UX | 3 (built-in `setup` + `accounts add` CLI handles consent screen + browser flow) | unverified | unverified |
| **Total** | **18/18** | **10/18 (rejected: no license)** | **12/18** |

### Per-product candidates (for completeness)

| Product | Candidate | Last release | License | Score |
|---|---|---|---|---|
| Calendar | `@cocal/google-calendar-mcp@2.6.1` | 2026-03-02 | MIT | acceptable |
| Drive | `@modelcontextprotocol/server-gdrive@2025.1.14` | 2025-01-14 | MIT | **REJECTED (16-month staleness)** |
| Sheets | `mcp-google-sheets@2.0.1` (filipptrigub) | 2025-11-25 | not verified | weak signal |

Rejecting the Drive server forces a pivot anyway. The combined server scores 18/18, dominates the per-product picks on every axis EXCEPT "modularity" — and modularity is a non-goal (per user mandate "pacote ÚNICO").

## Chosen server: `google-workspace-mcp@2.3.6`

**Repository:** <https://github.com/pm990320/google-workspace-mcp>
**License:** MIT
**Maintainer:** pm990320 (via GitHub Actions OIDC trusted publisher)
**Last release:** 2026-04-03 (~ 7 weeks before this audit)
**Engines:** `node >= 20.0.0` (compatible with SDK's `node >= 22.12.0`)
**Bin:** `google-workspace-mcp` → `dist/cli.js`

### Built-in CLI (the killer feature)

The package ships its own CLI that handles every concern the plan v1.1 thought we had to write ourselves:

| Plan v1.1 wanted | Provided by `google-workspace-mcp` CLI |
|---|---|
| `theokit setup gworkspace` walkthrough | `npx google-workspace-mcp setup` |
| OAuth consent + browser flow | `npx google-workspace-mcp accounts add <name>` |
| List/manage configured accounts | `npx google-workspace-mcp accounts list / remove` |
| Connectivity probe (`--probe`) | `npx google-workspace-mcp status` + `accounts test-permissions` |
| Read-only scope defaults | `npx google-workspace-mcp serve --read-only` (or `GOOGLE_MCP_READ_ONLY=true`) |
| Single `credentials.json` location | `~/.google-mcp/credentials.json` (configurable) |

### Implications for the plan

- **Phase 2 (factory) simplifies massively** — we just emit ONE `McpStdioServerConfig` entry running `npx google-workspace-mcp serve [--read-only]`, optionally with `--account <name>` flag.
- **Phase 3 (CLI setup) simplifies** — our `theokit setup gworkspace` becomes a thin shell-out wrapper that runs `npx google-workspace-mcp setup` + `accounts add` and gives our users a SDK-branded experience without re-implementing OAuth.
- **EC-1 (wrong-type OAuth credentials) MUST FIX still applies** — the upstream `setup` command does not warn about Web-vs-Desktop OAuth client type; we inspect the JSON shape before forwarding.
- **EC-10 (process count) mitigated naturally** — 1 child process per agent instead of 3.

### Risks (documented, accepted)

- **R1 — Single-maintainer dependency.** Mitigation: it's MIT, fork is always an option. The Hermes-style Python wrapper remains a viable Plan B if the package goes silent.
- **R2 — Python? No, it's Node.** README mentions "fastmcp library" in passing but install instructions are `npm install`, `tsc`, `node dist/...`. Bin file is `dist/cli.js`. Confirmed Node-only.
- **R3 — Per-account scope granularity.** Upstream uses one consent screen with broad scopes (`drive`, `gmail.modify`, etc.). Our `writable: false` default is enforced via `--read-only` flag at serve time, NOT scope narrowing. Trade-off: tokens are powerful; the server just refuses write operations at runtime. Document this.

## Locked decision

The plan v1.1 → v1.2 pivots to consume **`google-workspace-mcp@2.3.6`** as the single MCP backend. ADRs D341, D342, D343, D345 in the plan need rewording to reflect this. Coverage matrix and acceptance criteria stay the same — six recipes, OAuth setup walkthrough, read-only default, real-LLM validation.
