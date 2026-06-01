import { OrmConfigurationError } from "./errors.js";

const DEFAULT_DS = "default";

const DRIZZLE_NAME_SYMBOL = Symbol.for("drizzle:Name");

function resolveEntityName(entity: unknown): string {
  if (entity === null || entity === undefined) {
    throw new OrmConfigurationError(
      "[orm] getRepositoryToken: entity is null/undefined. Pass a Drizzle table object.",
    );
  }
  const ent = entity as Record<string | symbol, unknown>;
  const symbolName = ent[DRIZZLE_NAME_SYMBOL];
  if (typeof symbolName === "string" && symbolName.length > 0) return symbolName;
  const inner = ent._ as { name?: unknown } | undefined;
  if (inner && typeof inner.name === "string" && inner.name.length > 0) {
    return inner.name;
  }
  throw new OrmConfigurationError(
    "[orm] getRepositoryToken: cannot resolve entity name. Pass a Drizzle table (must have either Symbol.for('drizzle:Name') or _.name).",
  );
}

export function getRepositoryToken(entity: unknown, dataSourceName: string = DEFAULT_DS): string {
  const entityName = resolveEntityName(entity);
  return dataSourceName === DEFAULT_DS
    ? `REPO:${entityName}`
    : `REPO:${dataSourceName}:${entityName}`;
}
