/**
 * `@usetheo/gateway-teams` — public API.
 *
 * Microsoft Teams adapter for `@usetheo/gateway`, built on `@microsoft/teams.apps@^2`.
 *
 * @public
 */

// Re-export for consumer ergonomics.
export type { TeamsMessageEvent } from "@usetheo/gateway";
export { TeamsAdapter } from "./adapter.js";

export { mapTeamsError } from "./errors.js";
export { normalizeTeamsActivity, stripTeamsMentions } from "./normalize.js";
export { splitForTeams } from "./split.js";
export type { TeamsAdapterOptions } from "./types.js";
