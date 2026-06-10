import "reflect-metadata";
import { METADATA_KEYS } from "@theokit/di";

export interface AuthOptions {
  providers?: string[];
  sessionConfig?: unknown;
}

export function Auth(options: AuthOptions = {}): ClassDecorator {
  return (target: Function) => {
    Reflect.defineMetadata(METADATA_KEYS.AUTH, options, target);
  };
}

export function readAuthMetadata(target: Function): AuthOptions | undefined {
  return Reflect.getMetadata(METADATA_KEYS.AUTH, target) as AuthOptions | undefined;
}
