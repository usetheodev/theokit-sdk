/**
 * What every SubAgent delegation suite needs before its first assertion.
 *
 * `subagent-delegation.test.ts` was 1082 lines under two describe headers — 3.6x the next-largest
 * file in the tree — and every one of its ~50 tests opened with the same three things: a temp cwd,
 * a stubbed `AgentFacadePort`, and the parent-scope dispatch helper. Splitting the file by concern
 * meant either repeating them five times or naming them once.
 *
 * `useTempCwd()` is NOT called here: it registers vitest hooks and must run in the file that owns
 * the suite, so each split file calls it itself.
 */
import {
  type InheritedCredentials,
  withInheritedSubAgentCredentials,
} from "../../../src/internal/concurrency/subagent-credentials.js";
import type { CustomTool } from "../../../src/types/agent.js";

/**
 * theokit#148 — dispatch a subagent tool the way a run does: inside the parent's credential scope.
 *
 * These tests used to call `inheritSubAgentCredentials(tool, creds)` and then the handler, which
 * exercised a channel that rode the tool object. That channel is gone: any layer rebuilding the
 * object dropped it (including the SDK's own rebuild), so credentials now travel with the call.
 */
export async function delegateWithParent(
  tool: CustomTool,
  credentials: InheritedCredentials,
  input: string,
): Promise<unknown> {
  return withInheritedSubAgentCredentials(credentials, async () => tool.handler({ input }));
}
