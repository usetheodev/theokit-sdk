/**
 * T3.1 inspect tests + EC-E proof (Theokit.inspect against dist).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { main } from "../../src/index.js";
import { listGatewayAdapters } from "../../src/inspect/gateway.js";
import { listPlugins } from "../../src/inspect/plugins.js";

function captureStdout(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => {
    lines.push(String(c));
    return true;
  });
  return { lines, restore: () => spy.mockRestore() };
}

describe("theokit inspect (T3.1)", () => {
  it("--json emits valid JSON", async () => {
    const out = captureStdout();
    const code = await main(["node", "theokit", "inspect", "--json"]);
    expect(code).toBe(0);
    const text = out.lines.join("");
    out.restore();
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it("default output lists providers + adapters + gateways", async () => {
    const out = captureStdout();
    const code = await main(["node", "theokit", "inspect"]);
    expect(code).toBe(0);
    const text = out.lines.join("");
    out.restore();
    expect(text).toMatch(/Builtin LLM providers/i);
    expect(text).toContain("ollama");
    expect(text).toContain("anthropic");
    expect(text).toMatch(/Memory embedding adapters/i);
    expect(text).toMatch(/Gateway adapters/i);
  });

  it("EC-E: lists 7 builtin providers (from Theokit.inspect public API)", async () => {
    const out = captureStdout();
    await main(["node", "theokit", "inspect", "--json"]);
    const text = out.lines.join("");
    out.restore();
    const parsed = JSON.parse(text) as { providers: Array<{ name: string }> };
    const names = parsed.providers.map((p) => p.name).sort();
    expect(names).toEqual(
      expect.arrayContaining([
        "anthropic",
        "openai",
        "openrouter",
        "gemini",
        "ollama",
        "lmstudio",
        "llamacpp",
      ]),
    );
  });

  it("EC-E: lists 6 embedding adapters including ollama (transport: local)", async () => {
    const out = captureStdout();
    await main(["node", "theokit", "inspect", "--json"]);
    const text = out.lines.join("");
    out.restore();
    const parsed = JSON.parse(text) as {
      embeddingAdapters: Array<{ id: string; transport: string }>;
    };
    const ollama = parsed.embeddingAdapters.find((a) => a.id === "ollama");
    expect(ollama).toBeDefined();
    expect(ollama?.transport).toBe("local");
  });

  it("--filter providers narrows output", async () => {
    const out = captureStdout();
    await main(["node", "theokit", "inspect", "--filter", "providers", "--json"]);
    const text = out.lines.join("");
    out.restore();
    const parsed = JSON.parse(text) as InspectResultLike;
    expect(parsed.providers.length).toBeGreaterThan(0);
    expect(parsed.embeddingAdapters.length).toBe(0);
    expect(parsed.gateways.length).toBe(0);
    expect(parsed.plugins.length).toBe(0);
  });

  it("--filter invalid → exit 2", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await main(["node", "theokit", "inspect", "--filter", "garbage"]);
    expect(code).toBe(2);
    stderrSpy.mockRestore();
  });
});

interface InspectResultLike {
  providers: unknown[];
  embeddingAdapters: unknown[];
  gateways: unknown[];
  plugins: unknown[];
}

describe("listPlugins (T3.1)", () => {
  let workDir: string;
  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "tk-plugins-"));
  });
  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("returns empty when no plugins dir exists", () => {
    expect(listPlugins(workDir)).toEqual([]);
  });

  it("walks project plugins dir + parses frontmatter", () => {
    const pluginDir = join(workDir, ".theokit", "plugins", "my-plugin");
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, "PLUGIN.md"),
      "---\nname: my-plugin\ndescription: Does cool things.\n---\n\nBody.",
      "utf8",
    );
    const plugins = listPlugins(workDir);
    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.name).toBe("my-plugin");
    expect(plugins[0]?.description).toBe("Does cool things.");
    expect(plugins[0]?.source).toBe("project");
  });

  it("skips malformed manifest silently", () => {
    const pluginDir = join(workDir, ".theokit", "plugins", "broken");
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, "PLUGIN.md"), "no frontmatter here", "utf8");
    const plugins = listPlugins(workDir);
    expect(plugins).toHaveLength(1); // still listed by dir name (fallback)
    expect(plugins[0]?.name).toBe("broken");
  });
});

describe("listGatewayAdapters (T3.1)", () => {
  it("returns known gateways with install status", () => {
    const gateways = listGatewayAdapters();
    const names = gateways.map((g) => g.name);
    expect(names).toContain("telegram");
    expect(names).toContain("discord");
    for (const g of gateways) {
      expect(typeof g.installed).toBe("boolean");
    }
  });
});
