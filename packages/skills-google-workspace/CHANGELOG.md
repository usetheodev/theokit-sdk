# Changelog

## [0.1.0] - 2026-05-25

### Added
- Initial release. Google Workspace skill bundle for `@usetheo/sdk` (Roadmap v1.4 #5).
- `googleWorkspace(opts)` factory returns one `McpServerConfig` running
  `npx google-workspace-mcp@^2.3.0 serve [--read-only] [--account <name>]`.
- Read-only mode is the default (ADR D343); `writable: true` opts in.
- Single peer dep on `@usetheo/sdk`; the MCP server is spawned via `npx` —
  no transitive runtime dependency.
- ADRs D340-D348 cover the combined-server pivot from v1.1 of the plan.
