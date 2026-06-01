import { Container, Injectable } from "@usetheo/di";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getRepositoryToken,
  InjectRepository,
  ORM_DATA_SOURCE_TOKEN,
  OrmConfigurationError,
  OrmModule,
  Repository,
} from "../../src/index.js";

const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

const posts = sqliteTable("posts", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
});

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<{ users: typeof users; posts: typeof posts }>>;

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec("CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL);");
  sqlite.exec("CREATE TABLE posts (id TEXT PRIMARY KEY, title TEXT NOT NULL);");
  db = drizzle(sqlite, { schema: { users, posts } });
  OrmModule._resetForTesting();
});

afterEach(() => {
  sqlite.close();
  OrmModule._resetForTesting();
});

@Injectable()
class UserService {
  constructor(@InjectRepository(users) public readonly repo: Repository<typeof users>) {}
}

describe("OrmModule end-to-end", () => {
  it("forRoot registers the DataSource under the canonical token", () => {
    const providers = OrmModule.forRoot({ schema: { users }, dialect: "sqlite", db });
    const container = new Container({ providers });
    expect(container.has(ORM_DATA_SOURCE_TOKEN)).toBe(true);
  });

  it("forFeature registers a Repository per entity", async () => {
    const container = new Container({
      providers: [
        ...OrmModule.forRoot({ schema: { users, posts }, dialect: "sqlite", db }),
        ...OrmModule.forFeature([users, posts]),
      ],
    });
    expect(container.has(getRepositoryToken(users))).toBe(true);
    expect(container.has(getRepositoryToken(posts))).toBe(true);
  });

  it("resolves UserService with injected Repository via @InjectRepository", async () => {
    const container = new Container({
      providers: [
        ...OrmModule.forRoot({ schema: { users }, dialect: "sqlite", db }),
        ...OrmModule.forFeature([users]),
        UserService,
      ],
    });
    const svc = container.resolve(UserService);
    expect(svc).toBeInstanceOf(UserService);
    expect(svc.repo).toBeInstanceOf(Repository);
    await svc.repo.insert({ id: "u1", name: "Ada" });
    expect((await svc.repo.findById("u1"))?.name).toBe("Ada");
  });

  describe("EC-5 — forFeature called before forRoot", () => {
    it("throws OrmConfigurationError with actionable message", () => {
      expect(() => OrmModule.forFeature([users])).toThrow(OrmConfigurationError);
      expect(() => OrmModule.forFeature([users])).toThrow(/forRoot/);
    });

    it("throws when dataSourceName does not match registered forRoot dataSourceName", () => {
      OrmModule.forRoot({ schema: { users }, dialect: "sqlite", db });
      expect(() => OrmModule.forFeature([users], "analytics")).toThrow(OrmConfigurationError);
    });
  });

  describe("EC-4 — multi-dataSource token isolation", () => {
    it("default and named dataSource tokens are distinct", () => {
      OrmModule.forRoot({ schema: { users }, dialect: "sqlite", db });
      OrmModule.forRoot({
        schema: { users },
        dialect: "sqlite",
        db,
        dataSourceName: "analytics",
      });
      expect(getRepositoryToken(users, "default")).not.toBe(getRepositoryToken(users, "analytics"));
    });
  });

  describe("forRoot validation", () => {
    it("throws when opts.db is missing", () => {
      expect(() =>
        OrmModule.forRoot({ schema: { users }, dialect: "sqlite", db: null as never }),
      ).toThrow(OrmConfigurationError);
    });
    it("throws when opts.dialect is invalid", () => {
      expect(() =>
        OrmModule.forRoot({
          schema: { users },
          dialect: "oracle" as never,
          db,
        }),
      ).toThrow(OrmConfigurationError);
    });
  });

  describe("forFeature validation", () => {
    beforeEach(() => {
      OrmModule.forRoot({ schema: { users }, dialect: "sqlite", db });
    });
    it("throws when entities is not an array", () => {
      expect(() => OrmModule.forFeature({} as never)).toThrow(OrmConfigurationError);
    });
    it("throws when entities array is empty", () => {
      expect(() => OrmModule.forFeature([])).toThrow(OrmConfigurationError);
    });
  });
});
