/**
 * `@theokit/gateway-teams` — public API.
 *
 * Microsoft Teams adapter for `@theokit/gateway`, built on `@microsoft/teams.apps@^2`.
 *
 * @public
 */

// Re-export for consumer ergonomics.
export type { TeamsMessageEvent } from "@theokit/gateway";
export { TeamsAdapter } from "./adapter.js";

export { mapTeamsError } from "./errors.js";
export { normalizeTeamsActivity, stripTeamsMentions } from "./normalize.js";
export { splitForTeams } from "./split.js";
export type { TeamsAdapterOptions } from "./types.js";
