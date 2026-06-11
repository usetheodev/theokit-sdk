import "reflect-metadata";

import { METADATA_KEYS } from "@theokit/di";

export interface HitlOptions {
  tools: string[];
  timeoutMs?: number;
}

export interface HitlMetadata extends HitlOptions {
  methodKey: string | symbol;
}

export function Hitl(options: HitlOptions): MethodDecorator {
  return (target: object, propertyKey: string | symbol, _descriptor: PropertyDescriptor) => {
    const metadata: HitlMetadata = { ...options, methodKey: propertyKey };
    Reflect.defineMetadata(METADATA_KEYS.HITL, metadata, target.constructor);
  };
}

export function readHitlMetadata(
  target: abstract new (...args: never) => unknown,
): HitlMetadata | undefined {
  return Reflect.getMetadata(METADATA_KEYS.HITL, target) as HitlMetadata | undefined;
}
