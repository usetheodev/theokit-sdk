/**
 * Public API for `@usetheo/gateway-slack`.
 *
 * @public
 */

export { SlackAdapter, type SlackAdapterOptions } from "./adapter.js";
export { mapSlackError } from "./errors.js";
export { type BoltMessageBody, type NormalizeOptions, normalizeSlackEvent } from "./normalize.js";
export { splitForSlack } from "./split.js";
