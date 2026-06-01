import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OrmConfigurationError, OrmValidationError, Repository } from "../../src/index.js";

const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  age: integer("age"),
});

const noPkEntity = sqliteTable("no_pk", {
  value: text("value"),
});

let sqlite: Database.Database;
let db: BetterSQLite3Database<{ users: typeof users }>;
let repo: Repository<typeof users>;

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec("CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, age INTEGER);");
  db = drizzle(sqlite, { schema: { users } });
  repo = new Repository(db, users);
});

afterEach(() => {
  sqlite.close();
});

describe("Repository CRUD", () => {
  it("findById returns null when row does not exist", async () => {
    const out = await repo.findById("missing");
    expect(out).toBeNull();
  });

  it("findById returns row when it exists", async () => {
    await repo.insert({ id: "u1", name: "Ada", age: 30 });
    const out = await repo.findById("u1");
    expect(out).toEqual({ id: "u1", name: "Ada", age: 30 });
  });

  it("findMany without where returns all rows", async () => {
    await repo.insert({ id: "u1", name: "Ada" });
    await repo.insert({ id: "u2", name: "Babbage" });
    const all = await repo.findMany();
    expect(all).toHaveLength(2);
  });

  it("findMany with where filters", async () => {
    await repo.insert({ id: "u1", name: "Ada" });
    await repo.insert({ id: "u2", name: "Babbage" });
    const filtered = await repo.findMany(eq(users.id, "u1"));
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("u1");
  });

  it("insert returns inserted row", async () => {
    const out = await repo.insert({ id: "u1", name: "Ada", age: 30 });
    expect(out).toEqual({ id: "u1", name: "Ada", age: 30 });
  });

  it("update patches columns and returns updated row", async () => {
    await repo.insert({ id: "u1", name: "Ada", age: 30 });
    const out = await repo.update("u1", { age: 35 });
    expect(out.age).toBe(35);
    expect(out.name).toBe("Ada");
  });

  it("delete removes the row", async () => {
    await repo.insert({ id: "u1", name: "Ada" });
    await repo.delete("u1");
    const after = await repo.findById("u1");
    expect(after).toBeNull();
  });

  it("query exposes the Drizzle builder as escape hatch", async () => {
    await repo.insert({ id: "u1", name: "Ada" });
    const q: any = repo.query();
    expect(q).toBeDefined();
    expect(typeof q.where).toBe("function");
  });

  describe("EC-1 — entity without primary key", () => {
    it("throws at construction time", () => {
      expect(() => new Repository(db, noPkEntity as unknown as typeof users)).toThrow(
        OrmConfigurationError,
      );
    });
  });

  describe("EC-2 — id guard (prevents DELETE WHERE col IS NULL data loss)", () => {
    it("findById throws OrmValidationError on undefined", async () => {
      await expect(repo.findById(undefined as unknown as string)).rejects.toThrow(
        OrmValidationError,
      );
    });
    it("findById throws OrmValidationError on null", async () => {
      await expect(repo.findById(null as unknown as string)).rejects.toThrow(OrmValidationError);
    });
    it("findById throws OrmValidationError on empty string", async () => {
      await expect(repo.findById("")).rejects.toThrow(OrmValidationError);
    });
    it("update throws OrmValidationError on undefined id", async () => {
      await expect(repo.update(undefined as unknown as string, { age: 1 })).rejects.toThrow(
        OrmValidationError,
      );
    });
    it("delete throws OrmValidationError on undefined id (prevents data loss)", async () => {
      await expect(repo.delete(undefined as unknown as string)).rejects.toThrow(OrmValidationError);
    });
    it("delete throws OrmValidationError on empty string id", async () => {
      await expect(repo.delete("")).rejects.toThrow(OrmValidationError);
    });
  });

  describe("primary key resolution", () => {
    it("uses .primaryKey() column", () => {
      const r = new Repository(db, users);
      expect(r._primaryKeyName).toBe("id");
    });
  });
});
