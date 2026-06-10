import { METADATA_KEYS } from "../internal/metadata.js";

/**
 * @PostConstruct — method called after DI resolution completes.
 * All constructor dependencies are injected before this method runs.
 *
 * Supports async methods (EC-1): if the method returns a Promise,
 * the Container awaits it before returning the instance.
 *
 * @example
 * ```ts
 * @Injectable()
 * class CacheService {
 *   private cache!: Map<string, unknown>
 *
 *   @PostConstruct
 *   async init() {
 *     this.cache = await loadCacheFromRedis()
 *   }
 * }
 * ```
 */
export function PostConstruct(target: object, propertyKey: string | symbol): void {
  Reflect.defineMetadata(METADATA_KEYS.POST_CONSTRUCT, propertyKey, target.constructor);
}

/**
 * @PreDestroy — method called during container.dispose().
 * Called BEFORE Disposable.dispose() (EC-3).
 *
 * @example
 * ```ts
 * @Injectable()
 * class DbConnection {
 *   @PreDestroy
 *   async close() {
 *     await this.pool.end()
 *   }
 * }
 * ```
 */
export function PreDestroy(target: object, propertyKey: string | symbol): void {
  Reflect.defineMetadata(METADATA_KEYS.PRE_DESTROY, propertyKey, target.constructor);
}
