import type { AnyTable, DataSource, OrmRootOptions } from "../types.js";

export function createDataSource<TSchema extends Record<string, AnyTable>>(
  opts: OrmRootOptions<TSchema>,
): DataSource<TSchema> {
  const name = opts.dataSourceName ?? "default";
  return {
    name,
    dialect: opts.dialect,
    schema: opts.schema,
    db: opts.db,
  };
}
