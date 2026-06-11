import "reflect-metadata";
import { METADATA_KEYS } from "@theokit/di";

export interface CronOptions {
  schedule: string;
  timezone?: string;
}

export interface CronMetadata extends CronOptions {
  methodKey: string | symbol;
}

export function Cron(options: CronOptions): MethodDecorator {
  return (target: object, propertyKey: string | symbol, _descriptor: PropertyDescriptor) => {
    const metadata: CronMetadata = { ...options, methodKey: propertyKey };
    Reflect.defineMetadata(METADATA_KEYS.CRON, metadata, target.constructor);
  };
}

export function readCronMetadata(
  target: abstract new (...args: never) => unknown,
): CronMetadata | undefined {
  return Reflect.getMetadata(METADATA_KEYS.CRON, target) as CronMetadata | undefined;
}
