/**
 * Tests for loadMarkdownEntities (T0.2).
 *
 * 12 cases: 8 base + EC-8/9/10/11 from edge-case review.
 */

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { loadMarkdownEntities } from "../../../src/internal/persistence/markdown-config-loader.js";

const HookSchema = z.object({
  event: z.enum(["preToolUse", "postToolUse"]),
  matcher: z.string().min(1),
  command: z.string().min(1),
  enabled: z.boolean().optional().default(true),
});

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "md-loader-"));
});
afterEach(() => {
  // Restore perms before rm to avoid EACCES during cleanup
  try {
    chmodSync(dir, 0o755);
  } catch {}
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, content: string): string {
  const p = join(dir, name);
  writeFileSync(p, content, "utf8");
  return p;
}

describe("loadMarkdownEntities — flat pattern", () => {
  it("returns [] when dir does not exist (ENOENT graceful)", async () => {
    const result = await loadMarkdownEntities({
      dir: join(dir, "nope"),
      schema: HookSchema,
      errorCodePrefix: "hook",
    });
    expect(result).toEqual([]);
  });

  it("loads 3 .md files with valid frontmatter", async () => {
    for (const name of ["a", "b", "c"]) {
      write(
        `${name}.md`,
        `---\nevent: preToolUse\nmatcher: ^shell$\ncommand: echo ${name}\n---\nbody for ${name}`,
      );
    }
    const result = await loadMarkdownEntities({ dir, schema: HookSchema, errorCodePrefix: "hook" });
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.slug).sort()).toEqual(["a", "b", "c"]);
    expect(result.every((r) => r.frontmatter.enabled === true)).toBe(true);
  });

  it("extracts body and trims", async () => {
    write(
      "h.md",
      `---\nevent: preToolUse\nmatcher: ^s$\ncommand: echo\n---\n\nThis is the body.\n`,
    );
    const result = await loadMarkdownEntities({ dir, schema: HookSchema, errorCodePrefix: "hook" });
    expect(result[0]?.body).toBe("This is the body.");
  });

  it("empty body is allowed", async () => {
    write("h.md", `---\nevent: preToolUse\nmatcher: ^s$\ncommand: echo\n---\n`);
    const result = await loadMarkdownEntities({ dir, schema: HookSchema, errorCodePrefix: "hook" });
    expect(result).toHaveLength(1);
    expect(result[0]?.body).toBe("");
  });

  it("throws missing_frontmatter when no --- block", async () => {
    write("h.md", `event: preToolUse\nmatcher: ^s$\ncommand: echo`);
    await expect(
      loadMarkdownEntities({ dir, schema: HookSchema, errorCodePrefix: "hook" }),
    ).rejects.toThrow(/missing_frontmatter|Missing or malformed frontmatter/);
  });

  it("throws frontmatter_invalid when required field missing", async () => {
    write("h.md", `---\nevent: preToolUse\nmatcher: ^s$\n---\nbody`);
    await expect(
      loadMarkdownEntities({ dir, schema: HookSchema, errorCodePrefix: "hook" }),
    ).rejects.toThrow(/frontmatter_invalid|Invalid frontmatter/);
  });

  it("(EC-8) body markdown with --- horizontal rule does NOT confuse splitter", async () => {
    write(
      "h.md",
      `---\nevent: preToolUse\nmatcher: ^s$\ncommand: echo\n---\n## section\n\nsome prose\n\n---\n\nmore prose after horizontal rule`,
    );
    const result = await loadMarkdownEntities({ dir, schema: HookSchema, errorCodePrefix: "hook" });
    expect(result[0]?.body).toContain("horizontal rule");
    expect(result[0]?.frontmatter.matcher).toBe("^s$");
  });

  it("(EC-9) +++ (Hugo/TOML-style) is rejected as missing frontmatter", async () => {
    write("h.md", `+++\nevent = "preToolUse"\nmatcher = "^s$"\n+++\nbody`);
    await expect(
      loadMarkdownEntities({ dir, schema: HookSchema, errorCodePrefix: "hook" }),
    ).rejects.toThrow(/missing_frontmatter|Missing or malformed/);
  });

  it("(EC-10) truncated frontmatter without closing --- throws missing_frontmatter", async () => {
    write("h.md", `---\nevent: preToolUse\nmatcher: ^s$\n`); // no closing ---
    await expect(
      loadMarkdownEntities({ dir, schema: HookSchema, errorCodePrefix: "hook" }),
    ).rejects.toThrow(/missing_frontmatter|Missing or malformed/);
  });
});

describe("loadMarkdownEntities — nested pattern (plugins)", () => {
  it("loads PLUGIN.md from subdirs", async () => {
    mkdirSync(join(dir, "openrouter"), { recursive: true });
    writeFileSync(
      join(dir, "openrouter", "PLUGIN.md"),
      `---\nevent: preToolUse\nmatcher: ^x$\ncommand: echo\n---\n`,
      "utf8",
    );
    const result = await loadMarkdownEntities({
      dir,
      schema: HookSchema,
      pattern: "nested",
      errorCodePrefix: "plugin",
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.slug).toBe("openrouter");
  });

  it("silently skips subdir without PLUGIN.md", async () => {
    mkdirSync(join(dir, "openrouter"), { recursive: true });
    mkdirSync(join(dir, "anthropic"), { recursive: true });
    writeFileSync(
      join(dir, "openrouter", "PLUGIN.md"),
      `---\nevent: preToolUse\nmatcher: ^x$\ncommand: echo\n---\n`,
      "utf8",
    );
    // anthropic has no PLUGIN.md
    const result = await loadMarkdownEntities({
      dir,
      schema: HookSchema,
      pattern: "nested",
      errorCodePrefix: "plugin",
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.slug).toBe("openrouter");
  });
});

describe("loadMarkdownEntities — EACCES distinguished from ENOENT (EC-11)", () => {
  it("EACCES (chmod 000) throws ConfigurationError with code <prefix>_dir_read_error", async () => {
    // Skip on root since chmod doesn't restrict root.
    if (process.getuid?.() === 0) return;
    chmodSync(dir, 0o000);
    try {
      const promise = loadMarkdownEntities({ dir, schema: HookSchema, errorCodePrefix: "hook" });
      await expect(promise).rejects.toMatchObject({
        code: "hook_dir_read_error",
      });
    } finally {
      chmodSync(dir, 0o755);
    }
  });
});
