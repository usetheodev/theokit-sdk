import { METADATA_KEYS } from "../internal/metadata.js";

/**
 * @Qualifier(name) — parameter decorator for disambiguation.
 *
 * When multiple providers match the same token, @Qualifier narrows
 * the selection to the provider registered with that qualifier name.
 *
 * @example
 * ```ts
 * @Injectable()
 * class OrderService {
 *   constructor(@Qualifier('stripe') private payments: PaymentGateway) {}
 * }
 * ```
 */
export function Qualifier(name: string): ParameterDecorator {
  return (target: object, _propertyKey: string | symbol | undefined, parameterIndex: number) => {
    const existing: Map<number, string> =
      Reflect.getMetadata(METADATA_KEYS.QUALIFIER_NAMES, target) ?? new Map();
    existing.set(parameterIndex, name);
    Reflect.defineMetadata(METADATA_KEYS.QUALIFIER_NAMES, existing, target);
  };
}
