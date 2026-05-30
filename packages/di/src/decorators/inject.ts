import { METADATA_KEYS } from "../internal/metadata.js";
import type { Token } from "../types.js";

/**
 * Overrides the default class-token resolution for a constructor parameter.
 * Required when the parameter type is an interface (TS emits `Object`) or
 * a string token (e.g., `'DATABASE_URL'`).
 *
 * @example
 *   class GreeterService {
 *     constructor(
 *       @Inject('DATABASE_URL') readonly dbUrl: string,
 *       @Inject(LoggerInterface) readonly logger: LoggerInterface,
 *     ) {}
 *   }
 */
export function Inject(token: Token): ParameterDecorator {
  return (
    target: object,
    _propertyKey: string | symbol | undefined,
    parameterIndex: number,
  ): void => {
    const existing = Reflect.getMetadata(METADATA_KEYS.INJECT_TOKENS, target);
    const map: Map<number, Token> = existing instanceof Map ? existing : new Map();
    map.set(parameterIndex, token);
    Reflect.defineMetadata(METADATA_KEYS.INJECT_TOKENS, map, target);
  };
}
