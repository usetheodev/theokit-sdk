// Server-only entry: handlers that consume @usetheo/sdk (Agent runtime).
// Importing this from a client module is a bug — node:fs / node:path will
// leak into the browser bundle. Use the default `@usetheo/react` entry for
// client hooks.
//
// Pattern: mirrors Next.js `next/server` and Remix loader split.

export { type StreamAssistantOptions, streamAssistant } from "./stream-assistant.js";
export { type StreamCompletionOptions, streamCompletion } from "./stream-completion.js";
export { type StreamTheoChatOptions, streamTheoChat } from "./stream-theo-chat.js";
