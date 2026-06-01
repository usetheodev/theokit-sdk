// Public API surface for @usetheo/react.
//
// Spec: packages/react/src/wire-format.md (a peer vendor AI Data Stream v1).

export { type StreamAssistantOptions, streamAssistant } from "./stream-assistant.js";
export { type StreamCompletionOptions, streamCompletion } from "./stream-completion.js";
export { type StreamTheoChatOptions, streamTheoChat } from "./stream-theo-chat.js";
// G3 server actions — typed mutation hook (plan g3-server-actions-and-useaction
// v1.2 ADR D2, object-return shape, optimistic/rollback OPT-OUT v1).
export { type ActionErrorLike, type UseActionResult, useAction } from "./use-action.js";
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
