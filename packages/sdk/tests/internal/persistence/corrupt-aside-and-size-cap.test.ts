/**
 * T5.10 — Move-corrupt-aside + 1MB cap on markdown config files
 * (DR6 finding #10).
 *
 * (a) `readVersionedJson` on corrupt JSON: pre-T5.10 logged a stderr
 *     warning and returned `defaultValue()` — the corrupt file stayed
 *     on disk. On next run the same warning fired again (no healing).
 *     T5.10 renames the corrupt file to `<path>.corrupt.<epoch>` so
 *     the user can investigate later while the original path is freed
 *     for a fresh default.
 *
 * (b) `loadMarkdownEntities` on oversized file: pre-T5.10 no cap was
 *     enforced ("No file size cap enforced — `.theokit/` is trusted
 *     source" comment at line 63). A crafted multi-MB config file
 *     would be read into memory in full — a local DoS vector on
 *     resource-constrained environments (edge, CI workers). T5.10
 *     rejects files > 1MB before parsing with an honest error.
 */

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { loadMarkdownEntities } from "../../../src/internal/persistence/markdown-config-loader.js";
import { readVersionedJson } from "../../../src/internal/persistence/schema-version.js";

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `t510-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(testDir, { recursive: true });
});

describe("T5.10a — readVersionedJson moves corrupt file aside", () => {
  it("renames corrupt JSON to <path>.corrupt.<epoch> and returns default", async () => {
    const path = join(testDir, "state.json");
    await writeFile(path, "NOT VALID JSON {{{", "utf8");

    const result = await readVersionedJson({
      path,
      currentVersion: 1,
      migrate: (_p, _v) => ({ migrated: true, fresh: false }),
      defaultValue: () => ({ fresh: true }),
    });

    // Returns default value
    expect(result).toEqual({ fresh: true });

    // Original path no longer exists (was renamed)
    // Measured: ENOENT — the assertion IS that the file was moved aside, so the code is the claim.
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });

    // Corrupt file was moved aside with .corrupt.<epoch> suffix
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(testDir);
    const corruptFile = files.find((f) => f.startsWith("state.json.corrupt."));
    expect(corruptFile).toBeDefined();

    // Content preserved in the aside file
    const aside = await readFile(join(testDir, corruptFile!), "utf8");
    expect(aside).toBe("NOT VALID JSON {{{");
  });

  it("still works normally for valid JSON (no aside file created)", async () => {
    const path = join(testDir, "valid.json");
    const data = { _schemaVersion: 1, data: { hello: "world" } };
    await writeFile(path, JSON.stringify(data), "utf8");

    const result = await readVersionedJson<{ hello: string }>({
      path,
      currentVersion: 1,
      migrate: (_p, _v) => ({ hello: "migrated" }),
      defaultValue: () => ({ hello: "default" }),
    });

    expect(result).toEqual({ hello: "world" });
    // No .corrupt file created
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(testDir);
    expect(files.filter((f) => f.includes(".corrupt."))).toEqual([]);
  });
});

describe("T5.10b — loadMarkdownEntities rejects files > 1MB", () => {
  it("throws ConfigurationError when a markdown file exceeds 1MB", async () => {
    const configDir = join(testDir, "entities");
    await mkdir(configDir, { recursive: true });

    // Write a > 1MB markdown file with valid frontmatter
    const bigContent = `---\nname: big\n---\n${"x".repeat(1_100_000)}`;
    await writeFile(join(configDir, "big.md"), bigContent, "utf8");

    await expect(
      loadMarkdownEntities({
        dir: configDir,
        schema: z.object({ name: z.string() }),
        errorCodePrefix: "test_entity",
      }),
    ).rejects.toThrow(/1.*MB|size.*limit|too.*large/i);
  });

  it("accepts files under 1MB", async () => {
    const configDir = join(testDir, "entities-ok");
    await mkdir(configDir, { recursive: true });

    const content = `---\nname: small\n---\nBody content here`;
    await writeFile(join(configDir, "small.md"), content, "utf8");

    const results = await loadMarkdownEntities({
      dir: configDir,
      schema: z.object({ name: z.string() }),
      errorCodePrefix: "test_entity",
    });

    expect(results.length).toBe(1);
    expect(results[0]!.frontmatter.name).toBe("small");
  });
});
