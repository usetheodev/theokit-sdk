/**
 * Tests for loadHookConfig (T1.2) — MD-first with JSON fallback.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  _resetWarnOnceForTests,
  loadHookConfig,
} from "../../../src/internal/runtime/hooks-source.js";

let dir: string;
const stderrCapture: string[] = [];
let origWrite: typeof process.stderr.write;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hooks-src-"));
  stderrCapture.length = 0;
  origWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderrCapture.push(typeof chunk === "string" ? chunk : chunk.toString());
    return true;
  }) as typeof process.stderr.write;
  _resetWarnOnceForTests();
});

afterEach(() => {
  process.stderr.write = origWrite;
  rmSync(dir, { recursive: true, force: true });
});

function writeMd(slug: string, frontmatter: Record<string, unknown>, body = ""): void {
  mkdirSync(join(dir, ".theokit", "hooks"), { recursive: true });
  const lines = ["---"];
  for (const [k, v] of Object.entries(frontmatter)) lines.push(`${k}: ${String(v)}`);
  lines.push("---");
  if (body.length > 0) lines.push("", body);
  writeFileSync(join(dir, ".theokit", "hooks", `${slug}.md`), lines.join("\n"), "utf8");
}

function writeJson(content: unknown): void {
  mkdirSync(join(dir, ".theokit"), { recursive: true });
  writeFileSync(join(dir, ".theokit", "hooks.json"), JSON.stringify(content), "utf8");
}

describe("loadHookConfig — MD-first", () => {
  it("returns {} when neither MD dir nor JSON exists", async () => {
    const config = await loadHookConfig(dir);
    expect(config).toEqual({});
  });

  it("loads from .theokit/hooks/<name>.md without warning", async () => {
    writeMd("shell-policy", {
      event: "preToolUse",
      matcher: "^shell$",
      command: "node policy.js",
    });
    const config = await loadHookConfig(dir);
    expect(config.hooks?.preToolUse).toHaveLength(1);
    expect(config.hooks?.preToolUse?.[0]?.matcher).toBe("^shell$");
    expect(stderrCapture.join("")).not.toContain("deprecated");
  });

  it("groups multiple hooks by event with priority sort", async () => {
    writeMd("a", { event: "preToolUse", matcher: "^a$", command: "echo a", priority: 5 });
    writeMd("b", { event: "preToolUse", matcher: "^b$", command: "echo b", priority: 1 });
    writeMd("c", { event: "postToolUse", matcher: "^c$", command: "echo c" });
    const config = await loadHookConfig(dir);
    expect(config.hooks?.preToolUse).toHaveLength(2);
    expect(config.hooks?.postToolUse).toHaveLength(1);
    // priority asc → b (1) before a (5)
    expect(config.hooks?.preToolUse?.[0]?.matcher).toBe("^b$");
    expect(config.hooks?.preToolUse?.[1]?.matcher).toBe("^a$");
  });

  it("skips hooks with enabled: false", async () => {
    writeMd("on", { event: "preToolUse", matcher: "^on$", command: "echo on" });
    writeMd("off", {
      event: "preToolUse",
      matcher: "^off$",
      command: "echo off",
      enabled: false,
    });
    const config = await loadHookConfig(dir);
    expect(config.hooks?.preToolUse).toHaveLength(1);
    expect(config.hooks?.preToolUse?.[0]?.matcher).toBe("^on$");
  });
});

describe("loadHookConfig — JSON fallback (deprecation)", () => {
  it("falls back to hooks.json with one-time deprecation warn", async () => {
    writeJson({
      hooks: {
        preToolUse: [{ matcher: "^shell$", command: "node policy.js" }],
      },
    });
    const config = await loadHookConfig(dir);
    expect(config.hooks?.preToolUse).toHaveLength(1);
    expect(stderrCapture.join("")).toContain("hooks.json is deprecated");
  });

  it("warnOnce dedupes — 3 calls produce 1 stderr line", async () => {
    writeJson({ hooks: { preToolUse: [{ matcher: "^x$", command: "echo" }] } });
    await loadHookConfig(dir);
    await loadHookConfig(dir);
    await loadHookConfig(dir);
    const deprecationCount = stderrCapture.join("").split("hooks.json is deprecated").length - 1;
    expect(deprecationCount).toBe(1);
  });
});

describe("loadHookConfig — both MD and JSON", () => {
  it("MD wins; warn about removing JSON", async () => {
    writeMd("md-hook", {
      event: "preToolUse",
      matcher: "^md$",
      command: "echo md",
    });
    writeJson({ hooks: { preToolUse: [{ matcher: "^json$", command: "echo json" }] } });
    const config = await loadHookConfig(dir);
    expect(config.hooks?.preToolUse).toHaveLength(1);
    expect(config.hooks?.preToolUse?.[0]?.matcher).toBe("^md$");
    expect(stderrCapture.join("")).toContain("remove hooks.json");
  });

  it("empty MD dir falls back to JSON", async () => {
    mkdirSync(join(dir, ".theokit", "hooks"), { recursive: true });
    writeJson({ hooks: { preToolUse: [{ matcher: "^json$", command: "echo json" }] } });
    const config = await loadHookConfig(dir);
    expect(config.hooks?.preToolUse?.[0]?.matcher).toBe("^json$");
    expect(stderrCapture.join("")).toContain("hooks.json is deprecated");
  });
});
