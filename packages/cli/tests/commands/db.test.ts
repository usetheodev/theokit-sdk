import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDbCheckSchemaDrift, runDbExportSchema, runDbGenerate } from "../../src/commands/db.js";

let sandbox: string;

function writeStubExporter(sandbox: string, behavior: "ok" | "throw"): void {
  const stubDir = join(sandbox, "node_modules", "@theokit", "orm", "dist");
  mkdirSync(stubDir, { recursive: true });
  if (behavior === "throw") {
    writeFileSync(
      join(stubDir, "schema-export.js"),
      `export function exportSchemas() { throw new Error("simulated"); }`,
    );
  } else {
    writeFileSync(
      join(stubDir, "schema-export.js"),
      `export function exportSchemas(schema) {
        const out = {};
        for (const k of Object.keys(schema)) {
          out[k] = { $schema: "draft-07", title: k, type: "object", properties: {}, required: [], additionalProperties: false };
        }
        return out;
      }`,
    );
  }
}

function writeConfig(sandbox: string, schemaKeys: string[]): void {
  const entries = schemaKeys.map((k) => `${k}: {}`).join(", ");
  writeFileSync(join(sandbox, "orm.config.mjs"), `export default { schema: { ${entries} } };`);
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "theokit-db-test-"));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe("theokit db generate (without drizzle-kit installed)", () => {
  it("returns exit code 2 with actionable message", () => {
    const code = runDbGenerate({ cwd: sandbox });
    expect(code).toBe(2);
  });
});

describe("theokit db export-schema", () => {
  it("writes one .schema.json per entity", async () => {
    writeStubExporter(sandbox, "ok");
    writeConfig(sandbox, ["users", "posts"]);
    const code = await runDbExportSchema({
      cwd: sandbox,
      config: "orm.config.mjs",
    });
    expect(code).toBe(0);
    const usersPath = join(sandbox, ".theokit/schema/users.schema.json");
    const postsPath = join(sandbox, ".theokit/schema/posts.schema.json");
    const usersJson = JSON.parse(readFileSync(usersPath, "utf-8"));
    const postsJson = JSON.parse(readFileSync(postsPath, "utf-8"));
    expect(usersJson.title).toBe("users");
    expect(postsJson.title).toBe("posts");
  });

  it("returns exit code 2 when orm.config is missing", async () => {
    writeStubExporter(sandbox, "ok");
    const code = await runDbExportSchema({
      cwd: sandbox,
      config: "missing.mjs",
    });
    expect(code).toBe(2);
  });

  it("returns exit code 2 when @theokit/orm is not installed", async () => {
    writeConfig(sandbox, ["users"]);
    const code = await runDbExportSchema({
      cwd: sandbox,
      config: "orm.config.mjs",
    });
    expect(code).toBe(2);
  });

  it("returns exit code 1 when schema export throws", async () => {
    writeStubExporter(sandbox, "throw");
    writeConfig(sandbox, ["users"]);
    const code = await runDbExportSchema({
      cwd: sandbox,
      config: "orm.config.mjs",
    });
    expect(code).toBe(1);
  });
});

describe("theokit db check-schema-drift", () => {
  it("exits 0 when committed schemas match fresh schemas", async () => {
    writeStubExporter(sandbox, "ok");
    writeConfig(sandbox, ["users"]);
    await runDbExportSchema({ cwd: sandbox, config: "orm.config.mjs" });
    const code = await runDbCheckSchemaDrift({ cwd: sandbox, config: "orm.config.mjs" });
    expect(code).toBe(0);
  });

  it("exits 1 when committed schemas drift from fresh schemas (added entity)", async () => {
    writeStubExporter(sandbox, "ok");
    writeConfig(sandbox, ["users"]);
    await runDbExportSchema({ cwd: sandbox, config: "orm.config.mjs" });
    // Mutate config: add a second entity
    writeConfig(sandbox, ["users", "posts"]);
    const code = await runDbCheckSchemaDrift({ cwd: sandbox, config: "orm.config.mjs" });
    expect(code).toBe(1);
  });

  it("exits 1 when an entity is removed", async () => {
    writeStubExporter(sandbox, "ok");
    writeConfig(sandbox, ["users", "posts"]);
    await runDbExportSchema({ cwd: sandbox, config: "orm.config.mjs" });
    writeConfig(sandbox, ["users"]);
    const code = await runDbCheckSchemaDrift({ cwd: sandbox, config: "orm.config.mjs" });
    expect(code).toBe(1);
  });
});
