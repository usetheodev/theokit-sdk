/**
 * `googleWorkspace()` factory tests (T2.1 — Phase 2).
 *
 * Covers read-only default (D343), writable opt-in, account naming,
 * npm-package override, configDir env threading, and validation
 * (EC-5b — account must match identifier regex).
 */

import { describe, expect, it } from "vitest";

import { googleWorkspace, gworkspaceKey } from "../src/factory.js";

describe("googleWorkspace()", () => {
  it("test_default_returns_single_entry_under_gworkspace_key", () => {
    const result = googleWorkspace();
    expect(Object.keys(result)).toEqual(["gworkspace"]);
  });

  it("test_default_is_stdio_command_npx", () => {
    const result = googleWorkspace();
    const cfg = result.gworkspace;
    expect(cfg?.type).toBe("stdio");
    expect(cfg?.command).toBe("npx");
  });

  it("test_default_includes_read_only_flag (D343)", () => {
    const cfg = googleWorkspace().gworkspace;
    expect(cfg?.args).toContain("--read-only");
  });

  it("test_default_args_use_npm_specifier", () => {
    const cfg = googleWorkspace().gworkspace;
    expect(cfg?.args).toEqual(
      expect.arrayContaining(["-y", "google-workspace-mcp@^2.3.0", "serve"]),
    );
  });

  it("test_default_sets_GOOGLE_MCP_READ_ONLY_env", () => {
    const cfg = googleWorkspace().gworkspace;
    expect(cfg?.env?.GOOGLE_MCP_READ_ONLY).toBe("true");
  });

  it("test_writable_true_omits_read_only_flag_and_env", () => {
    const cfg = googleWorkspace({ writable: true }).gworkspace;
    expect(cfg?.args).not.toContain("--read-only");
    expect(cfg?.env?.GOOGLE_MCP_READ_ONLY).toBeUndefined();
  });

  it("test_named_account_changes_key_and_adds_flag", () => {
    const result = googleWorkspace({ account: "work" });
    expect(Object.keys(result)).toEqual(["gworkspace-work"]);
    const cfg = result["gworkspace-work"];
    expect(cfg?.args).toEqual(expect.arrayContaining(["--account", "work"]));
  });

  it("test_default_account_does_not_emit_account_flag", () => {
    const cfg = googleWorkspace({ account: "default" }).gworkspace;
    expect(cfg?.args).not.toContain("--account");
  });

  it("test_npm_package_override_threads_to_args", () => {
    const cfg = googleWorkspace({ npmPackage: "google-workspace-mcp@2.3.6" }).gworkspace;
    expect(cfg?.args?.[1]).toBe("google-workspace-mcp@2.3.6");
  });

  it("test_config_dir_threads_as_env_var", () => {
    const cfg = googleWorkspace({ configDir: "/tmp/my-creds" }).gworkspace;
    expect(cfg?.env?.GOOGLE_MCP_CONFIG_PATH).toBe("/tmp/my-creds");
  });

  it("test_empty_string_account_throws_TypeError (EC-5b)", () => {
    expect(() => googleWorkspace({ account: "" })).toThrow(TypeError);
  });

  it("test_invalid_account_name_throws_TypeError (EC-5b)", () => {
    expect(() => googleWorkspace({ account: "work account" })).toThrow(TypeError);
    expect(() => googleWorkspace({ account: "../etc" })).toThrow(TypeError);
    expect(() => googleWorkspace({ account: "a/b" })).toThrow(TypeError);
  });

  it("test_non_boolean_writable_throws_TypeError", () => {
    // @ts-expect-error — deliberately invalid
    expect(() => googleWorkspace({ writable: "yes" })).toThrow(TypeError);
  });

  it("test_empty_npm_package_throws_TypeError", () => {
    expect(() => googleWorkspace({ npmPackage: "" })).toThrow(TypeError);
  });
});

describe("gworkspaceKey()", () => {
  it("returns 'gworkspace' for default account", () => {
    expect(gworkspaceKey("default")).toBe("gworkspace");
  });

  it("returns 'gworkspace-<name>' for named account", () => {
    expect(gworkspaceKey("work")).toBe("gworkspace-work");
  });
});
