import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  boolean,
  numeric,
  bigint as pgBigint,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { blob, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportSchemas } from "../../src/schema-export.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "scripts/load_schema.py");

function pythonAvailable(): { ok: true } | { ok: false; reason: string } {
  const probe = spawnSync("python3", ["--version"], { encoding: "utf-8" });
  if (probe.status !== 0) {
    return { ok: false, reason: `python3 not on PATH (${probe.error?.message ?? "?"})` };
  }
  const m = /Python (\d+)\.(\d+)/.exec(probe.stdout || probe.stderr || "");
  if (!m) {
    return { ok: false, reason: `python3 version unparsable: ${probe.stdout}` };
  }
  const [major, minor] = [Number(m[1]), Number(m[2])];
  if (major < 3 || (major === 3 && minor < 10)) {
    return { ok: false, reason: `python3 too old: ${probe.stdout.trim()}` };
  }
  const saProbe = spawnSync("python3", ["-c", "import sqlalchemy"], { encoding: "utf-8" });
  if (saProbe.status !== 0) {
    return { ok: false, reason: "sqlalchemy not importable — pip install sqlalchemy" };
  }
  return { ok: true };
}

const probe = pythonAvailable();
const itSkippable = probe.ok ? it : it.skip;

const dogfoodLikeUsers = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  age: integer("age"),
  score: real("score"),
  payload: blob("payload"),
});

const dogfoodLikeEvents = pgTable("events", {
  id: uuid("id").primaryKey(),
  slug: varchar("slug", { length: 64 }).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  active: boolean("active").default(false),
  bigNum: pgBigint("big_num", { mode: "bigint" }),
  createdAt: timestamp("created_at").notNull(),
});

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), "orm-py-smoke-"));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

if (!probe.ok) {
  process.stderr.write(`[python-sqlalchemy-smoke] SKIPPED — ${probe.reason}\n`);
}

describe("Python SQLAlchemy polyglot smoke (ADR D11)", () => {
  itSkippable(
    "loads JSON Schema 7 emitted by @usetheo/orm into SQLAlchemy + create_all succeeds",
    () => {
      const schemas = exportSchemas({
        users: dogfoodLikeUsers,
        events: dogfoodLikeEvents,
      });
      const schemaDir = join(sandbox, "schemas");
      mkdirSync(schemaDir, { recursive: true });
      for (const [name, schema] of Object.entries(schemas)) {
        writeFileSync(
          join(schemaDir, `${name}.schema.json`),
          `${JSON.stringify(schema, null, 2)}\n`,
        );
      }
      const r = spawnSync("python3", [SCRIPT, schemaDir], { encoding: "utf-8" });
      if (r.status !== 0) {
        process.stderr.write(`stdout:\n${r.stdout ?? ""}\nstderr:\n${r.stderr ?? ""}\n`);
      }
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("loaded 2 table(s)");
      expect(r.stdout).toContain("users");
      expect(r.stdout).toContain("events");
    },
  );
});
