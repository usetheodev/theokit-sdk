/**
 * E2E contract for `.theokit/rules/*.md` path-scoped activation (T3).
 *
 * Proves the feature is FUNCTIONAL end-to-end: a path-scoped rule enters the
 * agent's context ONLY when the caller declares a matching in-scope file via
 * `agent.send(..., { contextPaths })`; an `alwaysApply` rule is always present;
 * and dropping the scope on the next send removes the scoped rule (no leak).
 */

import { afterEach, describe, expect, it } from "vitest";

import { Agent, type AgentOptions, type SDKAgent } from "../../src/index.js";
import { createTempWorkspace, type TempWorkspace } from "../helpers/temp-workspace.js";

type CtxAgent = SDKAgent & {
  context: { snapshot(): Promise<{ sources: Array<{ path?: string }> }> };
};

const paths = async (agent: CtxAgent): Promise<string[]> =>
  (await agent.context.snapshot()).sources.map((s) => s.path ?? "");

const hasFile = (list: string[], file: string): boolean => list.some((p) => p.endsWith(file));

describe("contract — .theokit/rules/*.md path-scoped activation (T3)", () => {
  let workspace: TempWorkspace | undefined;
  afterEach(async () => {
    await workspace?.cleanup();
    workspace = undefined;
  });

  const mkAgent = async (cwd: string): Promise<CtxAgent> => {
    const options: AgentOptions = {
      apiKey: "theo_test_rules_key",
      model: { id: "openai/gpt-4o-mini" },
      local: { cwd, settingSources: ["project"] },
      context: { manager: "file" },
    };
    return (await Agent.create(options)) as CtxAgent;
  };

  it("activates a path-scoped rule when a matching in-scope file is declared", async () => {
    workspace = await createTempWorkspace("project-with-rules");
    const agent = await mkAgent(workspace.cwd);

    await (await agent.send("Work on the API.", { contextPaths: ["src/api/users.ts"] })).wait();
    const withScope = await paths(agent);

    expect(hasFile(withScope, "rules/api.md")).toBe(true);
    expect(hasFile(withScope, "rules/always.md")).toBe(true);
    await agent.dispose();
  });

  it("keeps a scoped rule dormant when no in-scope file matches", async () => {
    workspace = await createTempWorkspace("project-with-rules");
    const agent = await mkAgent(workspace.cwd);

    await (await agent.send("Work on the UI.", { contextPaths: ["src/ui/button.tsx"] })).wait();
    const list = await paths(agent);

    expect(hasFile(list, "rules/api.md")).toBe(false);
    expect(hasFile(list, "rules/always.md")).toBe(true);
    await agent.dispose();
  });

  it("does not leak a scoped rule into a subsequent send with a different scope", async () => {
    workspace = await createTempWorkspace("project-with-rules");
    const agent = await mkAgent(workspace.cwd);

    await (await agent.send("API turn.", { contextPaths: ["src/api/users.ts"] })).wait();
    expect(hasFile(await paths(agent), "rules/api.md")).toBe(true);

    await (await agent.send("UI turn.", { contextPaths: ["src/ui/x.tsx"] })).wait();
    expect(hasFile(await paths(agent), "rules/api.md")).toBe(false);
    expect(hasFile(await paths(agent), "rules/always.md")).toBe(true);
    await agent.dispose();
  });
});
