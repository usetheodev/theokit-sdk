/**
 * Built-in tools for `@theokit/sdk` agents (`@theokit/sdk/tools`).
 *
 * Each factory returns a `CustomTool` ready to drop into `Agent.create`
 * or `createAgentFactory({ tools: [...] })`. All five share three
 * design rules:
 *
 *   1. **Project-scoped**. Every factory takes `{ projectRoot }` and
 *      gates every I/O call against that boundary via the SDK's
 *      `safePathJoin` + `assertNoSymlinkEscape` primitives.
 *
 *   2. **Sensitive files refused**. `.env*` (except `.env.example`),
 *      `.git/`, `node_modules/`, `.theo/`, and lock files are blocked
 *      via `isForbiddenPath`.
 *
 *   3. **JSON returns, never throws on user mistakes**. Handlers return
 *      `{ ok: true, ... }` or `{ ok: false, error: '...' }`. Real
 *      exceptions are reserved for SDK-side bugs (input parse errors,
 *      unexpected fs failures).
 *
 * Consumers: TheoKit Studio (the embedded coding agent), `cli-bot`
 * (the SDK's reference example), and any future coding-agent built on
 * `@theokit/sdk`.
 */

export { type CreateApplyPatchToolOptions, createApplyPatchTool } from "./apply-patch.js";
export { type CreateEditFileToolOptions, createEditFileTool } from "./edit-file.js";
// Output formatting utilities (moved from @theokit/theocode — SDK LEGO pieces)
export { formatCode, formatDiff, formatError, formatFileList } from "./formatter.js";
export { type CreateGitDiffToolOptions, createGitDiffTool } from "./git-diff.js";
export { type CreateGlobToolOptions, createGlobTool } from "./glob-files.js";
export {
  isBlockedIp,
  type ResolveAndScreenOptions,
  resolveAndScreen,
  type ScreenedFetchOptions,
  SsrfBlockedError,
  screenedFetch,
} from "./internal/network-guard.js";
export { buildEnvContext, buildRepoMap, type RepoMapOptions } from "./internal/repo-map.js";
export { CatastrophicCommandError, catastrophicShellReason } from "./internal/shell-guard.js";
export { type CreateListDirToolOptions, createListDirTool } from "./list-dir.js";
// Agent workflow tools (moved from @theokit/theocode — SDK LEGO pieces)
export { createPlanModeTool, type PlanModeTool } from "./plan-mode.js";
export { createQuestionTool, type QuestionTool, type QuestionToolOptions } from "./question.js";
export { type CreateReadFileToolOptions, createReadFileTool } from "./read-file.js";
export {
  type CreateRunVitestToolOptions,
  createRunVitestTool,
  type VitestSummary,
} from "./run-vitest.js";
export { type CreateSearchTextToolOptions, createSearchTextTool } from "./search-text.js";
export { type CreateShellToolOptions, createShellTool } from "./shell-exec.js";
export { createTodolistTool, type TodoItem, type TodolistTool } from "./todolist.js";
export { type TruncationOptions, type TruncationResult, truncateOutput } from "./truncation.js";
export { type CreateWebFetchToolOptions, createWebFetchTool } from "./web-fetch.js";
export {
  type CreateWebSearchToolOptions,
  createWebSearchTool,
  type WebSearchCallback,
  type WebSearchResult,
} from "./web-search.js";
export { type CreateWriteFileToolOptions, createWriteFileTool } from "./write-file.js";
