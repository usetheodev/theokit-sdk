// Public API surface for @usetheo/react.
//
// Spec: packages/react/src/wire-format.md (Vercel AI Data Stream v1).

export { type StreamAssistantOptions, streamAssistant } from "./stream-assistant.js";
export { type StreamCompletionOptions, streamCompletion } from "./stream-completion.js";
export { type StreamTheoChatOptions, streamTheoChat } from "./stream-theo-chat.js";
export {
  type UseTheoAssistantOptions,
  type UseTheoAssistantResult,
  useTheoAssistant,
} from "./use-theo-assistant.js";
export {
  type ChatMessage,
  type UseTheoChatOptions,
  type UseTheoChatResult,
  useTheoChat,
} from "./use-theo-chat.js";
export {
  type UseTheoCompletionOptions,
  type UseTheoCompletionResult,
  useTheoCompletion,
} from "./use-theo-completion.js";
