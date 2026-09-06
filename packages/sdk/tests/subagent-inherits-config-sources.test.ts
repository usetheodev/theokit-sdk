/**
 * #578 — a delegated child sees the configuration surfaces its parent was declared to read.
 *
 * `compatSources` arrived with #524 and neither carrier was updated, so a parent declaring
 * `compatSources: ["claude-code"]` read `.claude/agents/` and its child did not: a team could
 * delegate TO a role by name while the child could not resolve the rest of the team.
 */
import { describe, expect, it } from "vitest";

import { buildChildCreateOptions, type SubAgentSpec } from "../src/a2a/subagent.js";
import type { InheritedCredentials } from "../src/internal/concurrency/subagent-credentials.js";
import { resolveInheritedCredentials } from "../src/internal/local-agent/real-local-run-tools.js";
import type { AgentOptions } from "../src/types/agent.js";

const SPEC = { name: "r", description: "d", instructions: "i" } as SubAgentSpec;

describe("a delegated child inherits the parent's configuration surfaces", () => {
  it("carries compatSources from the parent's options into the credentials", () => {
    const parent = { local: { compatSources: ["claude-code"] } } as AgentOptions;

    expect(resolveInheritedCredentials(parent).compatSources).toEqual(["claude-code"]);
  });

  it("carries settingSources the same way", () => {
    const parent = { local: { settingSources: ["project"] } } as AgentOptions;

    expect(resolveInheritedCredentials(parent).settingSources).toEqual(["project"]);
  });

  it("puts both onto the child's local options", () => {
    const inherited: InheritedCredentials = {
      compatSources: ["claude-code"],
      settingSources: ["project"],
    };

    const child = buildChildCreateOptions(SPEC, inherited);

    expect(child.local?.compatSources).toEqual(["claude-code"]);
    expect(child.local?.settingSources).toEqual(["project"]);
  });

  it("does NOT clear the parent's sandbox posture while doing it", () => {
    // The trap this test exists for: `local` used to be written whole from the sandbox posture
    // alone, so a second `...{ local: … }` spread would have dropped it — trading a
    // missing-capability bug for a default-OPEN one, which is the wrong direction to trade.
    const child = buildChildCreateOptions(SPEC, {
      sandbox: true,
      compatSources: ["claude-code"],
    });

    expect(child.local?.sandboxOptions).toEqual({ enabled: true });
    expect(child.local?.compatSources).toEqual(["claude-code"]);
  });

  it("still omits `local` entirely when the parent declared none of the three", () => {
    // The control: if `local` appeared unconditionally, the four assertions above would pass on a
    // build that always emits an empty object, and they would prove nothing.
    expect(buildChildCreateOptions(SPEC, { apiKey: "k" }).local).toBeUndefined();
  });

  it("keeps the child's own sandbox choice ahead of the inherited surfaces", () => {
    const child = buildChildCreateOptions({ ...SPEC, sandbox: false } as SubAgentSpec, {
      sandbox: true,
      compatSources: ["claude-code"],
    });

    // An explicit `sandbox: false` is not the same as an absent one — it confines-OFF a child of a
    // confined parent, and inheriting the surfaces must not disturb that.
    expect(child.local?.sandboxOptions).toEqual({ enabled: false });
    expect(child.local?.compatSources).toEqual(["claude-code"]);
  });
});
