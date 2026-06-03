/**
 * `@theokit/skills-google-workspace` — public API.
 *
 * Spawns the combined `google-workspace-mcp` server (pm990320, MIT) as a
 * stdio MCP child of `@theokit/sdk`. Covers Calendar + Drive + Sheets +
 * Docs + Gmail + Slides + Forms. ADRs D340-D348.
 *
 * @public
 */

export { googleWorkspace } from "./factory.js";
export type { GoogleWorkspaceOptions } from "./types.js";
