/**
 * Token used by `@InjectAgent()` to look up the Agent provider. Importing
 * this directly (instead of using the decorator) lets you register a
 * custom factory under the same token.
 */
export const AGENT_TOKEN = "@usetheo/di-agent:Agent";
