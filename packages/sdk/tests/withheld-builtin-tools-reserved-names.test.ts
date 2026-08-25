/**
 * usetheokit/theokit-sdk#381, second half — what withholding a builtin does to the RESERVED name.
 *
 * `RESERVED_TOOL_NAMES = {shell, memory_search, memory_get}` made a consumer-supplied tool of the
 * same name throw `ConfigurationError(tool_reserved_name)`, so shadowing was not an escape from the
 * always-declared `shell` either: a consumer could neither remove the SDK's tool nor replace it.
 *
 * The reservation exists to stop two different tools answering to one name. A withheld builtin is
 * not declared, so there is no second tool and no collision to prevent — holding the name then
 * forbids something that cannot happen. Withholding therefore releases the name, and ONLY that
 * name: the builtins still declared stay reserved.
 *
 * Anti-vacuity: every "now allowed" case is paired with the identical options minus
 * `withheldBuiltinTools`, asserting the throw is still there. A validator that stopped reserving
 * anything passes the first half of each pair and fails the second.
 */

import { describe, expect, it } from "vitest";
import { ConfigurationError } from "../src/errors.js";
import {
  validateAgentOptions,
  validateToolCatalog,
} from "../src/internal/runtime/validation/validate-agent-options.js";
import type { AgentOptions, CustomTool } from "../src/types/agent.js";

function toolNamed(name: string): CustomTool {
  return {
    name,
    description: `a consumer tool called ${name}`,
    inputSchema: { type: "object", properties: {} },
    handler: () => "ok",
  };
}

function optionsWith(tools: CustomTool[], withheld?: AgentOptions["withheldBuiltinTools"]) {
  return {
    model: { id: "openai/gpt-4o-mini" },
    local: { cwd: process.cwd() },
    tools,
    ...(withheld !== undefined ? { withheldBuiltinTools: withheld } : {}),
  } as AgentOptions;
}

describe("reserved tool names against withheldBuiltinTools", () => {
  it("test_a_custom_tool_named_shell_is_rejected_when_shell_is_declared", () => {
    const options = optionsWith([toolNamed("shell")]);

    expect(() => validateAgentOptions(options)).toThrow(ConfigurationError);
    expect(() => validateAgentOptions(options)).toThrow(/reserved SDK tool name/);
  });

  it("test_withholding_shell_lets_a_custom_tool_claim_the_name", () => {
    const options = optionsWith([toolNamed("shell")], ["shell"]);

    expect(() => validateAgentOptions(options)).not.toThrow();
  });

  it("test_withholding_shell_does_not_release_the_memory_builtins", () => {
    // The release is per-name, not a blanket amnesty: `memory_get` is still declared for this
    // agent, so a second tool of that name would still be two tools under one name.
    const options = optionsWith([toolNamed("memory_get")], ["shell"]);

    expect(() => validateAgentOptions(options)).toThrow(/reserved SDK tool name/);
  });

  it("test_withholding_a_memory_builtin_releases_that_name", () => {
    const options = optionsWith([toolNamed("memory_search")], ["memory_search"]);

    expect(() => validateAgentOptions(options)).not.toThrow();
  });

  it("test_the_mcp_prefix_stays_reserved_whatever_is_withheld", () => {
    // `mcp_*` is not a builtin and is not on the withhold list's type, so no combination of
    // withheld builtins may free it — MCP tools are named at runtime from a server's own catalog.
    const options = optionsWith([toolNamed("mcp_thing")], ["shell", "memory_search", "memory_get"]);

    expect(() => validateAgentOptions(options)).toThrow(/reserved SDK tool name/);
  });

  it("test_the_per_send_catalog_check_reserves_everything_when_asked_nothing", () => {
    // `validateToolCatalog` is also the per-send entry point. Called without a withhold list — the
    // pre-#381 signature — it must behave exactly as it did, or an existing caller silently loses
    // the reservation.
    expect(() => validateToolCatalog([toolNamed("shell")])).toThrow(/reserved SDK tool name/);
  });

  it("test_the_per_send_catalog_check_honours_the_agents_withhold_list", () => {
    expect(() => validateToolCatalog([toolNamed("shell")], ["shell"])).not.toThrow();
  });

  it("test_an_empty_withhold_list_reserves_every_builtin", () => {
    const options = optionsWith([toolNamed("shell")], []);

    expect(() => validateAgentOptions(options)).toThrow(/reserved SDK tool name/);
  });
});
