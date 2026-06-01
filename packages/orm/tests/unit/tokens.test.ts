import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { getRepositoryToken, OrmConfigurationError } from "../../src/index.js";

const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

const posts = sqliteTable("posts", {
  id: text("id").primaryKey(),
});

describe("getRepositoryToken", () => {
  it("returns REPO:<name> for default dataSource", () => {
    expect(getRepositoryToken(users)).toBe("REPO:users");
  });

  it("returns REPO:<dataSource>:<name> for named dataSource", () => {
    expect(getRepositoryToken(users, "analytics")).toBe("REPO:analytics:users");
  });

  it("is stable across invocations", () => {
    expect(getRepositoryToken(users)).toBe(getRepositoryToken(users));
  });

  it("differentiates between entities", () => {
    expect(getRepositoryToken(users)).not.toBe(getRepositoryToken(posts));
  });

  it("treats default dataSource explicit and default as identical", () => {
    expect(getRepositoryToken(users)).toBe(getRepositoryToken(users, "default"));
  });

  it("throws OrmConfigurationError when entity is null", () => {
    expect(() => getRepositoryToken(null)).toThrow(OrmConfigurationError);
  });

  it("throws OrmConfigurationError when entity is undefined", () => {
    expect(() => getRepositoryToken(undefined)).toThrow(OrmConfigurationError);
  });

  it("throws OrmConfigurationError when entity is not a Drizzle table", () => {
    expect(() => getRepositoryToken({} as never)).toThrow(OrmConfigurationError);
  });
});
