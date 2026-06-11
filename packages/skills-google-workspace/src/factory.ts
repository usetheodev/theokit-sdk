/**
 * `googleWorkspace()` factory — emits one `McpStdioServerConfig` for the
 * combined upstream MCP server.
 *
 * @internal
 */

import type { McpStdioServerConfig } from "@theokit/sdk";

import type { GoogleWorkspaceOptions } from "./types.js";

/**
 * Sentinel runtime export — workaround for rollup-plugin-dts deep type-only
 * re-export bug. The marker is INTENTIONALLY orphan: it forces rollup-plugin-dts
 * to keep the module in the bundle so re-exports from `index.ts` resolve.
 *
 * @knipignore
 */
export const __gworkspaceFactoryMarker: unique symbol = Symbol("gworkspace-factory");

const DEFAULT_NPM_PACKAGE = "google-workspace-mcp@^2.3.0";
const DEFAULT_ACCOUNT = "default";

/**
 * Resolves to a stable map key (`gworkspace` or `gworkspace-<account>`) so
 * spreading `...googleWorkspace()` into `Agent.create({ mcpServers })` does
 * not collide with the user's other MCP servers under realistic naming.
 *
 * @internal
 */
export function gworkspaceKey(account: string): string {
  return account === DEFAULT_ACCOUNT ? "gworkspace" : `gworkspace-${account}`;
}

/**
 * Build the `McpStdioServerConfig` map. Single-entry by design — the
 * upstream server multiplexes Calendar + Drive + Sheets + Docs + Gmail +
 * Slides + Forms into one process (ADR D341 v1.2).
 *
 * @public
 */
export function googleWorkspace(
  opts: GoogleWorkspaceOptions = {},
): Record<string, McpStdioServerConfig> {
  validate(opts);

  const account = opts.account ?? DEFAULT_ACCOUNT;
  const npmPackage = opts.npmPackage ?? DEFAULT_NPM_PACKAGE;

  const args: string[] = ["-y", npmPackage, "serve"];
  if (opts.writable !== true) {
    // D343: read-only is the safe default. Toggle off only when writable=true.
    args.push("--read-only");
  }
  if (account !== DEFAULT_ACCOUNT) {
    args.push("--account", account);
  }

  const env: Record<string, string> = {};
  if (opts.configDir !== undefined && opts.configDir.length > 0) {
    env.GOOGLE_MCP_CONFIG_PATH = opts.configDir;
  }
  // Also enforce read-only via env so future serve flag changes can't bypass.
  if (opts.writable !== true) {
    env.GOOGLE_MCP_READ_ONLY = "true";
  }

  const config: McpStdioServerConfig = {
    type: "stdio",
    command: "npx",
    args,
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };

  return { [gworkspaceKey(account)]: config };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: validation ladder — one type check per public field, each is a single-responsibility guard; splitting hurts traceability when a user passes a bad option.
function validate(opts: GoogleWorkspaceOptions): void {
  if (opts.account !== undefined) {
    if (typeof opts.account !== "string" || opts.account.length === 0) {
      throw new TypeError("googleWorkspace: `account` must be a non-empty string");
    }
    // EC-5b: account name must be a stable identifier (no spaces, slashes,
    // shell metachars) — both for Map key safety and for upstream CLI.
    if (!/^[a-zA-Z0-9_-]+$/.test(opts.account)) {
      throw new TypeError(
        `googleWorkspace: \`account\` must match /^[a-zA-Z0-9_-]+$/ (got: "${opts.account}")`,
      );
    }
  }
  if (opts.writable !== undefined && typeof opts.writable !== "boolean") {
    throw new TypeError("googleWorkspace: `writable` must be a boolean");
  }
  if (opts.npmPackage !== undefined) {
    if (typeof opts.npmPackage !== "string" || opts.npmPackage.length === 0) {
      throw new TypeError("googleWorkspace: `npmPackage` must be a non-empty string");
    }
  }
  if (opts.configDir !== undefined) {
    if (typeof opts.configDir !== "string" || opts.configDir.length === 0) {
      throw new TypeError("googleWorkspace: `configDir` must be a non-empty string");
    }
  }
}
