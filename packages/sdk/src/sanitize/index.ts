/**
 * `@theokit/sdk/sanitize` — a professional, isolated tool-input sanitization primitive that
 * custom tools consume to clean model-emitted arguments (trim / coerce / json-repair). Pure,
 * synchronous, dependency-light. See `sanitizeToolInput`.
 *
 * @packageDocumentation
 */
export { sanitizeToolInput } from "./sanitize-tool-input.js";
export type { SanitizeOptions, SanitizeResult } from "./types.js";
