import { METADATA_KEYS } from "../internal/metadata.js";

/**
 * @Primary — class decorator marking a provider as the default
 * when multiple implementations exist for the same token.
 *
 * Resolution priority: @Qualifier > @Primary > error
 *
 * @example
 * ```ts
 * @Injectable()
 * @Primary
 * class StripePayments implements PaymentGateway { ... }
 *
 * @Injectable()
 * class PayPalPayments implements PaymentGateway { ... }
 *
 * // Without @Qualifier, StripePayments is resolved (it's @Primary)
 * ```
 */
export function Primary(target: Function): void {
  Reflect.defineMetadata(METADATA_KEYS.PRIMARY, true, target);
}
