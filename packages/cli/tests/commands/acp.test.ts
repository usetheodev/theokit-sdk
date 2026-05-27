/**
 * T5.1 — `theokit acp` CLI subcommand tests.
 *
 * Focus: option parsing, entry resolution, CJS/ESM default-export fallback (EC-4).
 * We do NOT spin up an actual ACP server end-to-end here (Phase 7 dogfood does).
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isValidAgentShape, resolveDefaultExport, runAcp } from "../../src/commands/acp.js";

describe("resolveDefaultExport (EC-4)", () => {
  it("esm_default_export_picked_up", () => {
    const mod = { default: () => "factory" };
    expect(resolveDefaultExport(mod)).toBe(mod.default);
  });

  it("cjs_module_exports_picked_up", () => {
    // CJS: `module.exports = factory`. Dynamic-imported, `default` is the whole module.
    // Wrappers without .default return the module itself (or interop's default may not exist).
    const factory = (): string => "x";
    expect(resolveDefaultExport(factory)).toBe(factory);
  });

  it("null_or_undefined_returns_undefined", () => {
    expect(resolveDefaultExport(null)).toBeUndefined();
    expect(resolveDefaultExport(undefined)).toBeUndefined();
  });
});

describe("isValidAgentShape", () => {
  it("function_is_valid", () => {
    expect(isValidAgentShape(() => undefined)).toBe(true);
  });

  it("object_with_agent_id_and_send_is_valid", () => {
    expect(isValidAgentShape({ agentId: "a-1", send: () => undefined })).toBe(true);
  });

  it("plain_object_is_invalid", () => {
    expect(isValidAgentShape({})).toBe(false);
  });

  it("null_is_invalid", () => {
    expect(isValidAgentShape(null)).toBe(false);
  });
});

describe("runAcp option validation", () => {
  let workDir: string;
  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "acp-cli-"));
  });
  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("run_acp_unknown_entry_path_exits_2", async () => {
    const code = await runAcp({ entry: "/definitely/not/there.ts" });
    expect(code).toBe(2);
  });

  it("run_acp_missing_default_export_exits_2", async () => {
    const entry = join(workDir, "noop.mjs");
    writeFileSync(entry, "// no default export");
    const code = await runAcp({ entry });
    expect(code).toBe(2);
  });

  it("run_acp_invalid_permission_exits_2", async () => {
    const entry = join(workDir, "agent.mjs");
    // ESM module exporting a fake factory.
    writeFileSync(entry, "export default () => ({ agentId: 'a', send: () => {} });");
    const code = await runAcp({
      entry,
      permission: "bogus" as never,
    });
    expect(code).toBe(2);
  });

  it("run_acp_invalid_permission_timeout_exits_2", async () => {
    const entry = join(workDir, "agent.mjs");
    writeFileSync(entry, "export default () => ({ agentId: 'a', send: () => {} });");
    const code = await runAcp({
      entry,
      permissionTimeoutMs: "not-a-number",
    });
    expect(code).toBe(2);
  });
});
