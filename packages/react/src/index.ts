// Client-only public surface for @usetheo/react.
//
// Spec: packages/react/src/wire-format.md (a peer vendor AI Data Stream v1).
//
// Server route handlers (streamAssistant, streamCompletion, streamTheoChat)
// moved to `@usetheo/react/server` because they import @usetheo/sdk
// (node:fs/path) at module-eval time and would leak into the client bundle
// if re-exported here. Pattern mirrors Next.js `next/server`.

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
