import type { Column, InferInsertModel, InferSelectModel, SQL, Table } from "drizzle-orm";
import { eq, getTableColumns } from "drizzle-orm";
import { OrmConfigurationError, OrmValidationError } from "./errors.js";
import { fillAgentColumns } from "./internal/agent-column-filler.js";
import { getTxContext } from "./internal/tx-context.js";

interface DrizzleColumnMeta {
  primary?: boolean;
  isPrimaryKey?: boolean;
  primaryKey?: boolean;
  name?: string;
}

function resolveTableName(table: unknown): string {
  if (table === null || typeof table !== "object") return "<unknown>";
  const sym = (table as Record<symbol, unknown>)[Symbol.for("drizzle:Name")];
  if (typeof sym === "string") return sym;
  const inner = (table as { _?: { name?: string } })._;
  return inner?.name ?? "<unknown>";
}

function detectPrimaryKey(table: Table): { name: string; column: Column } {
  const columns = getTableColumns(table) as Record<string, Column>;
  const tableName = resolveTableName(table);
  for (const [colName, col] of Object.entries(columns)) {
    const meta = col as unknown as DrizzleColumnMeta;
    if (meta.primary === true || meta.isPrimaryKey === true || meta.primaryKey === true) {
      return { name: colName, column: col };
    }
  }
  if ("id" in columns) {
    return { name: "id", column: columns.id as Column };
  }
  throw new OrmConfigurationError(
    `Entity "${tableName}" has no primary key. v0.1 requires a single-column PK named "id" or marked .primaryKey(). Use repo.query() for composite/custom keys.`,
  );
}

function assertValidId(method: string, id: unknown): asserts id is string | number {
  if (id === undefined || id === null) {
    throw new OrmValidationError(
      `Repository.${method}: id is required and non-null (received ${id === null ? "null" : "undefined"}).`,
    );
  }
  if (typeof id === "string" && id.length === 0) {
    throw new OrmValidationError(
      `Repository.${method}: id is required and non-empty (received empty string).`,
    );
  }
  if (typeof id !== "string" && typeof id !== "number") {
    throw new OrmValidationError(
      `Repository.${method}: id must be string or number (received ${typeof id}).`,
    );
  }
}

interface DialectAwareDb {
  insert: (table: unknown) => {
    values: (v: unknown) => {
      returning?: () => Promise<unknown[]>;
      run?: () => unknown;
      get?: () => unknown;
    };
  };
  update: (table: unknown) => {
    set: (v: unknown) => {
      where: (w: unknown) => {
        returning?: () => Promise<unknown[]>;
        run?: () => unknown;
      };
    };
  };
  delete: (table: unknown) => {
    where: (w: unknown) => Promise<unknown> | { run?: () => unknown };
  };
  select: () => { from: (table: unknown) => unknown };
}

export class Repository<T extends Table> {
  private readonly pkColumn: Column;
  private readonly pkName: string;
  private readonly tableName: string;

  constructor(
    private readonly defaultDb: unknown,
    private readonly table: T,
  ) {
    const pk = detectPrimaryKey(table);
    this.pkColumn = pk.column;
    this.pkName = pk.name;
    this.tableName = resolveTableName(table);
  }

  private get db(): DialectAwareDb {
    const tx = getTxContext();
    return (tx ?? this.defaultDb) as DialectAwareDb;
  }

  async findById(id: string | number): Promise<InferSelectModel<T> | null> {
    assertValidId("findById", id);
    // biome-ignore lint/suspicious/noExplicitAny: Drizzle generic chain — fluent query builder types are too complex to narrow at call site without importing internal Drizzle types
    const rows = (await (this.db.select().from(this.table) as any)
      .where(eq(this.pkColumn, id))
      .limit(1)) as unknown[];
    return (rows[0] as InferSelectModel<T>) ?? null;
  }

  async findMany(where?: SQL): Promise<InferSelectModel<T>[]> {
    // biome-ignore lint/suspicious/noExplicitAny: Drizzle generic chain — fluent query builder types are too complex to narrow at call site without importing internal Drizzle types
    const q = this.db.select().from(this.table) as any;
    const rows = (where ? await q.where(where) : await q) as unknown[];
    return rows as InferSelectModel<T>[];
  }

  async insert(values: InferInsertModel<T>): Promise<InferSelectModel<T>> {
    const filled = fillAgentColumns(this.table, values as Record<string, unknown>);
    // biome-ignore lint/suspicious/noExplicitAny: Drizzle generic chain — fluent query builder types are too complex to narrow at call site without importing internal Drizzle types
    const op = this.db.insert(this.table).values(filled) as any;
    if (typeof op.returning === "function") {
      const rows = (await op.returning()) as unknown[];
      const row = rows[0];
      if (row === undefined) {
        throw new OrmValidationError(
          `Repository.insert on "${this.tableName}" returned zero rows. Driver may not support .returning() (MySQL?). Use repo.query() with manual fetch for that dialect.`,
        );
      }
      return row as InferSelectModel<T>;
    }
    throw new OrmConfigurationError(
      `Repository.insert on "${this.tableName}": driver does not expose .returning(). v0.1 supports SQLite/Postgres. For MySQL, use repo.query() and manually fetch the inserted row.`,
    );
  }

  async update(
    id: string | number,
    patch: Partial<InferInsertModel<T>>,
  ): Promise<InferSelectModel<T>> {
    assertValidId("update", id);
    const filled = fillAgentColumns(this.table, patch as Record<string, unknown>);
    // biome-ignore lint/suspicious/noExplicitAny: Drizzle generic chain — fluent query builder types are too complex to narrow at call site without importing internal Drizzle types
    const op = this.db.update(this.table).set(filled).where(eq(this.pkColumn, id)) as any;
    if (typeof op.returning === "function") {
      const rows = (await op.returning()) as unknown[];
      const row = rows[0];
      if (row === undefined) {
        throw new OrmValidationError(
          `Repository.update on "${this.tableName}" id="${id}": no row matched.`,
        );
      }
      return row as InferSelectModel<T>;
    }
    throw new OrmConfigurationError(
      `Repository.update on "${this.tableName}": driver does not expose .returning(). v0.1 supports SQLite/Postgres. For MySQL, use repo.query() and manually fetch.`,
    );
  }

  async delete(id: string | number): Promise<void> {
    assertValidId("delete", id);
    // biome-ignore lint/suspicious/noExplicitAny: Drizzle generic chain — fluent query builder types are too complex to narrow at call site without importing internal Drizzle types
    await (this.db.delete(this.table) as any).where(eq(this.pkColumn, id));
  }

  query() {
    return this.db.select().from(this.table);
  }

  /** @internal exposed for tests */
  get _primaryKeyName(): string {
    return this.pkName;
  }
}
