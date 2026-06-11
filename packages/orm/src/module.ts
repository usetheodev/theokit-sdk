import type { Provider } from "@theokit/di";
import { OrmConfigurationError } from "./errors.js";
import { createDataSource } from "./internal/data-source.js";
import { Repository } from "./repository.js";
import { getRepositoryToken } from "./tokens.js";
import {
  type AnyTable,
  type DataSource,
  ORM_DATA_SOURCE_TOKEN,
  type OrmRootOptions,
} from "./types.js";

const registeredDataSources = new Set<string>();

function dataSourceTokenFor(name: string): string {
  return name === "default" ? ORM_DATA_SOURCE_TOKEN : `${ORM_DATA_SOURCE_TOKEN}:${name}`;
}

function entityArrayOrThrow(entities: unknown): readonly unknown[] {
  if (!Array.isArray(entities)) {
    throw new OrmConfigurationError(
      `OrmModule.forFeature: entities must be an array of Drizzle tables. Got ${typeof entities}`,
    );
  }
  if (entities.length === 0) {
    throw new OrmConfigurationError(
      "OrmModule.forFeature: entities array is empty. Provide at least one Drizzle table.",
    );
  }
  return entities;
}

export const OrmModule = {
  forRoot<TSchema extends Record<string, AnyTable>>(opts: OrmRootOptions<TSchema>): Provider[] {
    if (opts === null || typeof opts !== "object") {
      throw new OrmConfigurationError(
        "OrmModule.forRoot: options is required. Pass { schema, dialect, db }.",
      );
    }
    if (opts.db === undefined || opts.db === null) {
      throw new OrmConfigurationError(
        "OrmModule.forRoot: opts.db is required. Pass the Drizzle db instance (e.g. drizzle(client, { schema })).",
      );
    }
    if (!["sqlite", "pg", "mysql"].includes(opts.dialect)) {
      throw new OrmConfigurationError(
        `OrmModule.forRoot: opts.dialect must be one of "sqlite" | "pg" | "mysql". Got "${opts.dialect}".`,
      );
    }
    const name = opts.dataSourceName ?? "default";
    const dataSource = createDataSource(opts);
    const token = dataSourceTokenFor(name);

    registeredDataSources.add(name);

    return [
      {
        provide: token,
        useValue: dataSource,
      },
    ];
  },

  forFeature(entities: readonly unknown[], dataSourceName: string = "default"): Provider[] {
    const ents = entityArrayOrThrow(entities);

    if (!registeredDataSources.has(dataSourceName)) {
      throw new OrmConfigurationError(
        `OrmModule.forFeature called${
          dataSourceName === "default" ? "" : ` for dataSource="${dataSourceName}"`
        } before OrmModule.forRoot. Call OrmModule.forRoot(opts) first in your Container providers array.`,
      );
    }

    const dsToken = dataSourceTokenFor(dataSourceName);

    return ents.map((entity) => ({
      provide: getRepositoryToken(entity, dataSourceName),
      inject: [dsToken],
      useFactory: (ds: DataSource) => new Repository(ds.db, entity as AnyTable),
    }));
  },

  /** @internal — testing escape hatch to reset module-level state */
  _resetForTesting(): void {
    registeredDataSources.clear();
  },
};
