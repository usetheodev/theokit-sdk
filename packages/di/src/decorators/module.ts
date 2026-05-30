import type { ClassConstructor, Provider, Token } from "../types.js";

/**
 * Module declaration shape accepted by `@Module({...})`.
 *
 * - `providers` — providers registered into the container when this module
 *   is loaded. Bare classes are expanded to ClassProvider shorthand.
 * - `imports` — other `@Module()` classes whose exported providers are
 *   visible to this module.
 * - `exports` — tokens from this module's `providers` that should be
 *   visible to outer modules that `import` this one.
 */
export interface ModuleMetadata {
  providers?: ReadonlyArray<Provider | ClassConstructor>;
  imports?: ReadonlyArray<ClassConstructor>;
  exports?: ReadonlyArray<Token>;
}

/**
 * Metadata key used by `@Module()` + `Container.registerModule()`.
 * Kept here (not in internal/metadata.ts) so the import graph stays tidy:
 * module decorator depends only on its own key.
 */
export const MODULE_METADATA_KEY = "usetheo:di:module";

/**
 * Mark a class as a DI module. The class itself never gets instantiated —
 * the decorator just attaches metadata that `Container.registerModule()`
 * reads.
 *
 * @example
 *   @Module({
 *     providers: [UserService, { provide: 'DB_URL', useValue: process.env.DB }],
 *     imports: [LoggingModule],
 *     exports: [UserService],
 *   })
 *   class UserModule {}
 */
export function Module(metadata: ModuleMetadata): ClassDecorator {
  return (target: object): void => {
    Reflect.defineMetadata(MODULE_METADATA_KEY, metadata, target);
  };
}

/**
 * Read metadata from a class decorated with `@Module()`. Returns `undefined`
 * when the class has no decorator (consumer error).
 */
export function readModuleMetadata(target: ClassConstructor): ModuleMetadata | undefined {
  if (typeof Reflect === "undefined" || typeof Reflect.getMetadata !== "function") {
    return undefined;
  }
  const out = Reflect.getMetadata(MODULE_METADATA_KEY, target) as unknown;
  if (out === undefined || out === null) return undefined;
  if (typeof out !== "object") return undefined;
  return out as ModuleMetadata;
}
