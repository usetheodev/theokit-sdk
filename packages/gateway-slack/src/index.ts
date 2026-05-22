/**
 * Public API for `@usetheo/gateway-slack`.
 *
 * @public
 */

export { SlackAdapter, type SlackAdapterOptions } from "./adapter.js";
export { mapSlackError } from "./errors.js";
export { normalizeSlackEvent, type BoltMessageBody, type NormalizeOptions } from "./normalize.js";
export { splitForSlack } from "./split.js";
