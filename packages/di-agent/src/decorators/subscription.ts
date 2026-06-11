import "reflect-metadata";
import { METADATA_KEYS } from "@theokit/di";

export interface SubscriptionOptions {
  name: string;
  transport?: string;
}

export function Subscription(options: SubscriptionOptions): PropertyDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const existing: Map<string | symbol, SubscriptionOptions> =
      Reflect.getMetadata(METADATA_KEYS.SUBSCRIPTION, target.constructor) ?? new Map();
    existing.set(propertyKey, options);
    Reflect.defineMetadata(METADATA_KEYS.SUBSCRIPTION, existing, target.constructor);
  };
}

export function readSubscriptionMetadata(
  target: abstract new (...args: never) => unknown,
): ReadonlyMap<string | symbol, SubscriptionOptions> {
  return Reflect.getMetadata(METADATA_KEYS.SUBSCRIPTION, target) ?? new Map();
}
