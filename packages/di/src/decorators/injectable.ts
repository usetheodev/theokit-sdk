import { type InjectableMetadata, METADATA_KEYS } from "../internal/metadata.js";
import type { Scope } from "../types.js";

/**
 * Options accepted by `@Injectable({...})`.
 */
export interface InjectableOptions {
  scope?: Scope;
}

/**
 * Marks a class as DI-managed. Without this decorator, the container
 * rejects the class at registration time (per v1.1 EC-1).
 *
 * @example
 *   @Injectable()
 *   class UserService { constructor(private db: DbConnection) {} }
 *
 *   @Injectable({ scope: Scope.REQUEST })
 *   class RequestLogger { ... }
 */
export function Injectable(options: InjectableOptions = {}): ClassDecorator {
  return (target: object): void => {
    const metadata: InjectableMetadata =
      options.scope !== undefined ? { scope: options.scope } : {};
    Reflect.defineMetadata(METADATA_KEYS.INJECTABLE, metadata, target);
  };
}
