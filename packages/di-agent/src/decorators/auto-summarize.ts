import "reflect-metadata";

import { METADATA_KEYS } from "@theokit/di";

export interface AutoSummarizeOptions {
  triggerFraction?: number;
  keepNewest?: number;
  model?: string;
}

const DEFAULTS: Required<Omit<AutoSummarizeOptions, "model">> = {
  triggerFraction: 0.85,
  keepNewest: 4,
};

export function AutoSummarize(options: AutoSummarizeOptions = {}): ClassDecorator {
  return (target: Function) => {
    const resolved = { ...DEFAULTS, ...options };
    Reflect.defineMetadata(METADATA_KEYS.AUTO_SUMMARIZE, resolved, target);
  };
}

export function readAutoSummarizeMetadata(
  target: abstract new (...args: never) => unknown,
): (Required<Omit<AutoSummarizeOptions, "model">> & { model?: string }) | undefined {
  return Reflect.getMetadata(METADATA_KEYS.AUTO_SUMMARIZE, target) as
    | (Required<Omit<AutoSummarizeOptions, "model">> & { model?: string })
    | undefined;
}
