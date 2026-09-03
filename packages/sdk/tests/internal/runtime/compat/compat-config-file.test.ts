import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { setDiagnosticsSink } from "../../../../src/internal/diagnostics.js";
import { readCompatConfigFile } from "../../../../src/internal/runtime/compat/compat-config-file.js";
import { removeTempDirRobustSync } from "../../../helpers/temp-workspace.js";

/**
 * usetheokit/theokit-sdk#524, the declarative half.
 *
 * `local: { compatSources: [...] }` is the code form. This is the file form the issue sketched in
 * TOML — `.theokit/config.json` here, JSON rather than TOML, because the SDK already reads JSON
 * everywhere (`settings.json`, `mcp.json`, `context.json`) and has no TOML parser or dependency for
 * one. The SHAPE is unchanged: the same `compat.adapters` array, the same per-entry form
 * (`CompatSourceDeclaration` — a bare kind string, or `{ kind, import }`) that `local.compatSources`
 * already accepts in code. One shape, two entry points.
 *
 * Read with `readFileSync`, not the async `readFile` every other reader in this package uses: the
 * caller is `Agent`'s SYNCHRONOUS constructor, which resolves `compatSources` before any of its
 * submanagers exist to await anything. A small, optional, once-per-agent JSON read is exactly the
 * case this codebase already accepts sync I/O for (`existsSync` throughout the same constructor).
 */
const dirs: string[] = [];
afterEach(() => {
  setDiagnosticsSink(undefined);
  for (const d of dirs.splice(0)) removeTempDirRobustSync(d);
});

function workspace(): string {
  const ws = mkdtempSync(join(tmpdir(), "compat-config-file-"));
  dirs.push(ws);
  return ws;
}

describe("readCompatConfigFile", () => {
  it("returns [] when no config.json exists — the ordinary case", () => {
    expect(readCompatConfigFile(workspace())).toEqual([]);
  });

  it("reads compat.adapters, in the exact CompatSourceDeclaration shape", () => {
    const ws = workspace();
    mkdirSync(join(ws, ".theokit"), { recursive: true });
    writeFileSync(
      join(ws, ".theokit", "config.json"),
      JSON.stringify({
        compat: { adapters: [{ kind: "claude-code", import: ["skills", "subagents"] }] },
      }),
    );

    expect(readCompatConfigFile(ws)).toEqual([
      { kind: "claude-code", import: ["skills", "subagents"] },
    ]);
  });

  it("accepts the bare-string form too, same as the code option", () => {
    const ws = workspace();
    mkdirSync(join(ws, ".theokit"), { recursive: true });
    writeFileSync(
      join(ws, ".theokit", "config.json"),
      JSON.stringify({ compat: { adapters: ["claude-code"] } }),
    );

    expect(readCompatConfigFile(ws)).toEqual(["claude-code"]);
  });

  it("returns [] for a config.json that declares no compat section — not every use of this file is about compat", () => {
    const ws = workspace();
    mkdirSync(join(ws, ".theokit"), { recursive: true });
    writeFileSync(join(ws, ".theokit", "config.json"), JSON.stringify({ unrelated: true }));

    expect(readCompatConfigFile(ws)).toEqual([]);
  });

  it("warns and returns [] on malformed JSON — fails closed, not silently", () => {
    const ws = workspace();
    mkdirSync(join(ws, ".theokit"), { recursive: true });
    writeFileSync(join(ws, ".theokit", "config.json"), "{ not json");
    const lines: string[] = [];
    setDiagnosticsSink((m) => lines.push(m));

    expect(readCompatConfigFile(ws)).toEqual([]);
    expect(lines.join("")).toContain("config.json");
  });

  it("warns and returns [] when compat.adapters is not an array", () => {
    const ws = workspace();
    mkdirSync(join(ws, ".theokit"), { recursive: true });
    writeFileSync(
      join(ws, ".theokit", "config.json"),
      JSON.stringify({ compat: { adapters: "claude-code" } }),
    );
    const lines: string[] = [];
    setDiagnosticsSink((m) => lines.push(m));

    expect(readCompatConfigFile(ws)).toEqual([]);
    expect(lines.join("")).toContain("compat.adapters");
  });
});
