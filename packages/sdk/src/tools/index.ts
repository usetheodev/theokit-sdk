/**
 * Built-in tools for `@usetheo/sdk` agents (`@usetheo/sdk/tools`).
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
 * `@usetheo/sdk`.
 */

export { type CreateGitDiffToolOptions, createGitDiffTool } from "./git-diff.js";
export { type CreateListDirToolOptions, createListDirTool } from "./list-dir.js";
export { type CreateReadFileToolOptions, createReadFileTool } from "./read-file.js";
export {
  type CreateRunVitestToolOptions,
  createRunVitestTool,
  type VitestSummary,
} from "./run-vitest.js";
export { type CreateSearchTextToolOptions, createSearchTextTool } from "./search-text.js";
