/**
 * B-015 — ten `ConfigurationError` throws in the Agent.create trust boundary that lcov reports at
 * count 0.
 *
 * `rules/architecture.md` § 2 puts validation at the system boundary: past it, data is trusted. This
 * module IS that boundary, and ten of its refusals had never been observed refusing. Line 247 is the
 * one with teeth — `memory_path_traversal` keeps a caller's memory store inside the workspace, and a
 * regression that inverted or dropped the predicate would let it point anywhere on the filesystem
 * while the suite stayed green.
 *
 * Every test asserts the CODE, never merely that something threw. All ten guards construct the same
 * `ConfigurationError`, so `toThrow(ConfigurationError)` passes for all of them interchangeably and
 * cannot detect a guard firing for the wrong reason. `rules/testing.md` § 4.1 asks a negative-case
 * test for the specific typed error, which is what the code is.
 */

import { describe, expect, it } from "vitest";

import { ConfigurationError } from "../../../src/errors.js";
import {
  validateAgentOptions,
  validateToolCatalog,
} from "../../../src/internal/runtime/validation/validate-agent-options.js";
import type { AgentOptions } from "../../../src/types/agent.js";
import type { CustomTool } from "../../../src/types/agent-prims.js";

/** The smallest option bag that reaches the guards without tripping an earlier one. */
function options(extra: Record<string, unknown>): AgentOptions {
  return { model: "openai/gpt-4o", ...extra } as unknown as AgentOptions;
}

/** Asserts the refusal is a `ConfigurationError` carrying `code` — the field a caller branches on. */
function expectRefusal(act: () => void, code: string): ConfigurationError {
  const err = (() => {
    try {
      act();
    } catch (e) {
      return e;
    }
    throw new Error(`expected a refusal with code ${code}, but the call was accepted`);
  })();
  expect(err).toBeInstanceOf(ConfigurationError);
  expect((err as ConfigurationError).code, "the code a caller switches on").toBe(code);
  return err as ConfigurationError;
}

describe("memory storePath — the guard that keeps the store inside the workspace", () => {
  // Table-driven over the three independent clauses of the predicate. The accepted case is not
  // decoration: without it, inverting the predicate to `if (true)` would survive every rejection test.
  const rejected: Array<[label: string, storePath: string]> = [
    ["a relative escape", "../outside/mem"],
    ["an absolute path", "/etc/theokit/mem"],
    ["a windows drive letter", "C:\\Users\\x\\mem"],
  ];

  for (const [label, storePath] of rejected) {
    it(`test_${label.replace(/ /g, "_")}_is_rejected`, () => {
      const err = expectRefusal(
        () => validateAgentOptions(options({ memory: { storePath } })),
        "memory_path_traversal",
      );
      expect(err.message, "the offending path belongs in the message").toContain(storePath);
    });
  }

  it("test_a_plain_relative_path_is_accepted", () => {
    expect(() =>
      validateAgentOptions(options({ memory: { storePath: ".theokit/mem" } })),
    ).not.toThrow();
  });
});

describe("cloud options — configurations that are legal locally and unusable in the sandbox", () => {
  it("test_a_reserved_theokit_env_prefix_is_rejected", () => {
    const err = expectRefusal(
      () => validateAgentOptions(options({ cloud: { envVars: { THEOKIT_HOME: "/tmp" } } })),
      "reserved_env_prefix",
    );
    expect(err.message, "the offending key must be named").toContain("THEOKIT_HOME");
  });

  it("test_a_cloud_stdio_server_with_cwd_is_rejected", () => {
    const err = expectRefusal(
      () =>
        validateAgentOptions(
          options({
            cloud: {},
            mcpServers: { local_fs: { command: "node", args: ["s.js"], cwd: "/srv" } },
          }),
        ),
      "cloud_stdio_cwd_rejected",
    );
    expect(err.message, "the offending server must be named").toContain("local_fs");
  });

  it("test_local_plugin_paths_are_rejected_for_cloud_agents", () => {
    // The item believed this one was already tested — a grep found the code string in
    // tests/golden/agent/cloud-tool-parity.golden.test.ts. lcov disagreed: line 76, count 0. The
    // string appears; the throw never fired.
    expectRefusal(
      () => validateAgentOptions(options({ cloud: {}, plugins: { paths: ["./local-plugin"] } })),
      "cloud_plugin_path_rejected",
    );
  });
});

describe("subagents — two adjacent guards where a copy-paste puts the wrong code on the wrong branch", () => {
  it("test_a_subagent_without_a_description_is_rejected", () => {
    const err = expectRefusal(
      () => validateAgentOptions(options({ agents: { helper: { prompt: "do the thing" } } })),
      "subagent_missing_description",
    );
    expect(err.message).toContain("helper");
  });

  it("test_a_subagent_without_a_prompt_is_rejected", () => {
    const err = expectRefusal(
      () => validateAgentOptions(options({ agents: { helper: { description: "helps" } } })),
      "subagent_missing_prompt",
    );
    expect(err.message).toContain("helper");
  });
});

describe("custom tools — the contract, and the order it is checked in", () => {
  const tool = (extra: Record<string, unknown>): CustomTool =>
    ({
      name: "lookup",
      description: "looks things up",
      inputSchema: { type: "object" },
      handler: () => Promise.resolve("ok"),
      ...extra,
    }) as unknown as CustomTool;

  it("test_a_tool_without_a_name_is_rejected", () => {
    expectRefusal(() => validateToolCatalog([tool({ name: "" })]), "tool_missing_name");
  });

  it("test_a_tool_without_a_description_is_rejected", () => {
    const err = expectRefusal(
      () => validateToolCatalog([tool({ description: "" })]),
      "tool_missing_description",
    );
    expect(err.message).toContain("lookup");
  });

  it("test_a_tool_without_an_input_schema_is_rejected", () => {
    expectRefusal(
      () => validateToolCatalog([tool({ inputSchema: undefined })]),
      "tool_missing_schema",
    );
  });

  it("test_a_tool_without_a_handler_is_rejected", () => {
    expectRefusal(
      () => validateToolCatalog([tool({ handler: undefined })]),
      "tool_missing_handler",
    );
  });

  it("test_the_first_failure_reported_is_the_name_not_a_later_one", () => {
    // `validateSingleTool` runs name → description → schema → handler. The order is behaviour: a
    // caller fixing errors one at a time depends on it being stable, and a tool missing everything
    // must report the first failure rather than an arbitrary one.
    expectRefusal(
      () =>
        validateToolCatalog([
          tool({ name: "", description: "", inputSchema: undefined, handler: undefined }),
        ]),
      "tool_missing_name",
    );
  });
});
