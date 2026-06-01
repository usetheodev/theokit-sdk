import { AsyncLocalStorage } from "node:async_hooks";
import type { AgentContext } from "./types.js";

const als = new AsyncLocalStorage<AgentContext>();

export function withAgentContext<R>(ctx: AgentContext, fn: () => R | Promise<R>): Promise<R> {
  return Promise.resolve(als.run(ctx, fn));
}

export function getAgentContext(): AgentContext | undefined {
  return als.getStore();
}
