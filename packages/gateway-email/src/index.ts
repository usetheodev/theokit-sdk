/**
 * `@usetheo/gateway-email` — public API.
 *
 * Email adapter for `@usetheo/gateway`, built on `nodemailer` + `imapflow` + `mailparser`.
 *
 * @public
 */

// Re-export the MessageEvent variant.
export type { EmailMessageEvent } from "@usetheo/gateway";
export { EmailAdapter } from "./adapter.js";
export { mapEmailError } from "./errors.js";
export { extractAddr, isAllowedSender, isAutomatedSender } from "./filters.js";
export { type NormalizeOptions, normalizeEmail } from "./normalize.js";
export { SeenUidSet } from "./seen-uids.js";
export { type ThreadContext, ThreadStore } from "./thread-store.js";
export type { EmailAdapterOptions } from "./types.js";
