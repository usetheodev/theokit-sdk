/**
 * Public option types for `@usetheo/skills-google-workspace` (ADRs D340-D348).
 *
 * @public
 */

/**
 * Sentinel runtime export — workaround for rollup-plugin-dts deep type-only
 * re-export bug. The marker is INTENTIONALLY orphan: it forces rollup-plugin-dts
 * to keep the module in the bundle so re-exports from `index.ts` resolve.
 *
 * @knipignore
 */
export const __gworkspaceTypesMarker: unique symbol = Symbol("gworkspace-types");

/**
 * Options for the {@link googleWorkspace} factory.
 *
 * The factory targets `google-workspace-mcp@^2.3.0` (pm990320, MIT). Phase 0
 * audit summary lives at `.claude/knowledge-base/reviews/gworkspace-mcp-inventory.md`.
 *
 * @public
 */
export interface GoogleWorkspaceOptions {
  /**
   * Named account previously registered via `theokit setup gworkspace` (or
   * upstream `npx google-workspace-mcp accounts add <name>`). Defaults to
   * `"default"`.
   */
  readonly account?: string;
  /**
   * When `true`, the server is launched WITHOUT `--read-only`, exposing write
   * tools (Drive write, Gmail send, Calendar create, etc.). Defaults to
   * `false` — read-only is the safe default per ADR D343.
   */
  readonly writable?: boolean;
  /**
   * Override the npm specifier used by `npx`. Defaults to
   * `google-workspace-mcp@^2.3.0`. Useful for pinning in air-gapped CI.
   */
  readonly npmPackage?: string;
  /**
   * Override the upstream credentials directory. Forwarded as
   * `GOOGLE_MCP_CONFIG_PATH` env. Defaults to upstream's `~/.google-mcp`.
   */
  readonly configDir?: string;
}
