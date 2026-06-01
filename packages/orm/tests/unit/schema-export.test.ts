import {
  boolean,
  json,
  numeric,
  bigint as pgBigint,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { blob, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { OrmSchemaExportError } from "../../src/errors.js";
import { exportSchema, exportSchemas } from "../../src/schema-export.js";

const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  age: integer("age"),
  score: real("score"),
  payload: blob("payload"),
});

const pgEntities = pgTable("entities", {
  id: uuid("id").primaryKey(),
  slug: varchar("slug", { length: 64 }).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  active: boolean("active").default(false),
  meta: json("meta"),
  bigNum: pgBigint("big_num", { mode: "bigint" }),
  createdAt: timestamp("created_at").notNull(),
});

describe("schema-export — exportSchema (single table)", () => {
  it("emits a JSON Schema 7 object with title", () => {
    const s = exportSchema(users);
    expect(s.$schema).toBe("http://json-schema.org/draft-07/schema#");
    expect(s.title).toBe("users");
    expect(s.type).toBe("object");
    expect(s.additionalProperties).toBe(false);
  });

  it("maps text → string", () => {
    const s = exportSchema(users);
    expect(s.properties.name).toEqual({ type: "string" });
  });

  it("maps integer → integer", () => {
    const s = exportSchema(users);
    expect(s.properties.age).toEqual({ type: "integer" });
  });

  it("maps real → number", () => {
    const s = exportSchema(users);
    expect(s.properties.score).toEqual({ type: "number" });
  });

  it("maps blob → string with contentEncoding base64", () => {
    const s = exportSchema(users);
    expect(s.properties.payload?.type).toBe("string");
    expect(s.properties.payload?.contentEncoding).toBe("base64");
  });

  it("includes notNull-without-default columns in required[]", () => {
    const s = exportSchema(users);
    expect(s.required).toContain("name");
    expect(s.required).not.toContain("age");
  });
});

describe("schema-export — PG types", () => {
  it("maps uuid → string + format uuid", () => {
    const s = exportSchema(pgEntities);
    expect(s.properties.id).toEqual({ type: "string", format: "uuid" });
  });

  it("maps varchar({length}) → string + maxLength", () => {
    const s = exportSchema(pgEntities);
    expect(s.properties.slug).toEqual({ type: "string", maxLength: 64 });
  });

  it("maps numeric({precision, scale}) → string + decimal format + multipleOf", () => {
    const s = exportSchema(pgEntities);
    expect(s.properties.amount?.type).toBe("string");
    expect(s.properties.amount?.format).toBe("decimal");
    expect(s.properties.amount?.multipleOf).toBeCloseTo(0.01);
  });

  it("maps boolean → boolean", () => {
    const s = exportSchema(pgEntities);
    expect(s.properties.active?.type).toBe("boolean");
  });

  it("maps json → object", () => {
    const s = exportSchema(pgEntities);
    expect(s.properties.meta?.type).toBe("object");
  });

  it("maps bigint → string + format int64", () => {
    const s = exportSchema(pgEntities);
    expect(s.properties.bigNum).toEqual({ type: "string", format: "int64" });
  });

  it("maps timestamp → string + format date-time", () => {
    const s = exportSchema(pgEntities);
    expect(s.properties.createdAt).toEqual({ type: "string", format: "date-time" });
  });

  it("emits defaults for hasDefault columns", () => {
    const s = exportSchema(pgEntities);
    expect(s.properties.active?.default).toBe(false);
  });
});

describe("schema-export — exportSchemas (record)", () => {
  it("returns object keyed by table name", () => {
    const out = exportSchemas({ users, pgEntities });
    expect(Object.keys(out).sort()).toEqual(["entities", "users"]);
  });
});

describe("schema-export — EC-11 unknown type throws", () => {
  it("throws OrmSchemaExportError when an entry has an unknown column shape", () => {
    const fakeTable = {
      [Symbol.for("drizzle:Name")]: "fake",
      [Symbol.for("drizzle:Columns")]: {
        x: { dataType: "weird-tsvector", columnType: "tsvector", notNull: true, hasDefault: false },
      },
    } as unknown as Parameters<typeof exportSchema>[0];
    expect(() => exportSchema(fakeTable)).toThrow(OrmSchemaExportError);
  });
});
