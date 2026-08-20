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

/**
 * A minimal option bag. `model` is inert on every path this file exercises — `options.local` is always
 * undefined, so the model check is never entered — and is kept only because a bag without it reads as
 * incomplete to the next author. Review flagged the original comment ("the smallest bag that reaches
 * the guards without tripping an earlier one") as claiming a necessity it does not have.
 */
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
        () => validateAgentOptions(options({ memory: { enabled: true, storePath } })),
        "memory_path_traversal",
      );
      expect(err.message, "the offending path belongs in the message").toContain(storePath);
    });
  }

  it("test_a_plain_relative_path_is_accepted", () => {
    expect(() =>
      validateAgentOptions(options({ memory: { enabled: true, storePath: ".theokit/mem" } })),
    ).not.toThrow();
  });
});

describe("cloud options — refusals on the cloud path", () => {
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

  it("test_plugins_paths_is_not_validated_the_guard_was_removed_as_dead_code", () => {
    // B-107 (measured 2026-08-19): this test used to assert `cloud_plugin_path_rejected` fired for
    // `plugins: { paths: [...] }` on a cloud agent. Review found that assertion could only be
    // exercised via an `as unknown as AgentOptions` cast — `plugins.paths` was never part of the
    // public option surface. `PluginsSettings` (types/providers.ts) declares only
    // `enabled?: string[]`, and `paths` appeared nowhere in `src/` outside the removed validator's
    // own cast (confirmed with `tsc --noEmit --strict`: TS2353, unknown property). No supported
    // caller could ever trip the guard, so it — and its sibling in `plugins-manager.ts`
    // (`assertCloudRules`) — were removed rather than kept as untested defensive code (parsimony
    // ladder rung 1).
    //
    // This is the accept-side regression for that removal: a `plugins.paths` cast-in property is
    // simply ignored now, not rejected. Cloud agents still validate cleanly with a real (enabled-list)
    // plugins config — see the cloud-agent + plugins coverage elsewhere in this file/suite.
    expect(() =>
      validateAgentOptions(options({ cloud: {}, plugins: { paths: ["./local-plugin"] } })),
    ).not.toThrow();
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

  // `validateSingleTool` runs name → description → schema → handler, and the order is behaviour: a
  // caller fixing errors one at a time depends on it being stable.
  //
  // Review caught the first version pinning only ONE THIRD of that. It passed a tool missing
  // EVERYTHING, so it could only ever observe the first check — swapping `validateToolSchema` and
  // `validateToolDescription` in the source left the entire 4486-test suite green. Nothing anywhere
  // constructed a tool missing description AND schema, which is precisely the case the rationale
  // describes.
  //
  // Table-driven over ADJACENT pairs instead. Each row omits exactly two fields and names which of
  // the two must be reported, so every neighbouring swap in the chain breaks a row.
  const orderPairs: Array<[label: string, omit: Record<string, unknown>, expected: string]> = [
    ["name before description", { name: "", description: "" }, "tool_missing_name"],
    [
      "description before schema",
      { description: "", inputSchema: undefined },
      "tool_missing_description",
    ],
    [
      "schema before handler",
      { inputSchema: undefined, handler: undefined },
      "tool_missing_schema",
    ],
  ];

  for (const [label, omit, expected] of orderPairs) {
    it(`test_the_check_order_reports_${label.replace(/ /g, "_")}`, () => {
      expectRefusal(() => validateToolCatalog([tool(omit)]), expected);
    });
  }
});
