import type { Table } from "drizzle-orm";

export type AnyTable = Table;

export type Dialect = "sqlite" | "pg" | "mysql";

export interface OrmRootOptions<
  TSchema extends Record<string, AnyTable> = Record<string, AnyTable>,
> {
  schema: TSchema;
  dialect: Dialect;
  db: unknown;
  dataSourceName?: string;
}

export interface DataSource<TSchema extends Record<string, AnyTable> = Record<string, AnyTable>> {
  readonly name: string;
  readonly dialect: Dialect;
  readonly schema: TSchema;
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle db handle has driver-specific shape (BetterSQLite3Database vs PgDatabase vs MySqlDatabase); narrow types come at use-site via Repository<T> generic
  readonly db: any;
}

export const ORM_DATA_SOURCE_TOKEN = "ORM_DATA_SOURCE";

export interface AgentContext {
  agentId?: string;
  runId?: string;
  conversationId?: string;
}
