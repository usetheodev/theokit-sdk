import { METADATA_KEYS } from "../internal/metadata.js";

/**
 * Marks a constructor parameter as optional. If the corresponding
 * dependency is not registered, the parameter receives `undefined`
 * instead of throwing `TokenNotFoundError`.
 *
 * `@Optional()` ONLY swallows `TokenNotFoundError` — other errors
 * (e.g., factory throws, cyclic dependency) propagate.
 *
 * @example
 *   class GreeterService {
 *     constructor(@Optional() private logger?: Logger) {}
 *   }
 */
export function Optional(): ParameterDecorator {
  return (
    target: object,
    _propertyKey: string | symbol | undefined,
    parameterIndex: number,
  ): void => {
    const existing = Reflect.getMetadata(METADATA_KEYS.OPTIONAL_FLAGS, target);
    const set: Set<number> = existing instanceof Set ? existing : new Set();
    set.add(parameterIndex);
    Reflect.defineMetadata(METADATA_KEYS.OPTIONAL_FLAGS, set, target);
  };
}
