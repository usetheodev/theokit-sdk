import { OrmConfigurationError } from "./errors.js";
import { withTxContext } from "./internal/tx-context.js";
import type { DataSource } from "./types.js";

const DATA_SOURCE_KEY = Symbol.for("usetheo:orm:dataSource");

/**
 * Internal: any class containing @Transactional methods must have its
 * DataSource injected via this protocol so the decorator can find it.
 * The OrmModule arranges this automatically when classes are DI-managed.
 *
 * Direct (non-DI) instantiation requires manually calling
 * `bindDataSourceToInstance(instance, ds)` before invoking the method.
 */
export function bindDataSourceToInstance(instance: object, ds: DataSource): void {
  (instance as Record<symbol, unknown>)[DATA_SOURCE_KEY] = ds;
}

function readDataSourceFromInstance(instance: object): DataSource | undefined {
  const v = (instance as Record<symbol, unknown>)[DATA_SOURCE_KEY];
  return (v as DataSource | undefined) ?? undefined;
}

interface TransactionalOptions {
  isolationLevel?: "read uncommitted" | "read committed" | "repeatable read" | "serializable";
}

export function Transactional(_opts: TransactionalOptions = {}): MethodDecorator {
  return function transactionalDecorator(
    _target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor {
    const original = descriptor.value;
    if (typeof original !== "function") {
      throw new OrmConfigurationError(
        `@Transactional on ${String(propertyKey)}: target is not a method.`,
      );
    }

    descriptor.value = async function transactionalWrapper(
      this: object,
      ...args: unknown[]
    ): Promise<unknown> {
      const ds = readDataSourceFromInstance(this);
      if (!ds) {
        throw new OrmConfigurationError(
          `@Transactional ${String(propertyKey)}: no DataSource bound to instance. The class must be DI-managed via Container.resolve OR bindDataSourceToInstance(instance, ds) must be called before invoking the method.`,
        );
      }

      const db = ds.db as {
        transaction?: (cb: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
      };
      if (typeof db.transaction !== "function") {
        throw new OrmConfigurationError(
          `@Transactional ${String(propertyKey)}: DataSource.db does not expose .transaction(). Ensure you passed a Drizzle db instance.`,
        );
      }

      return db.transaction(async (tx: unknown) => {
        return withTxContext(tx, () => original.apply(this, args));
      });
    };

    return descriptor;
  };
}
