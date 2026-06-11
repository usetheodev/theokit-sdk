import { AsyncLocalStorage } from "node:async_hooks";

const txAls = new AsyncLocalStorage<unknown>();

export function withTxContext<R>(tx: unknown, fn: () => R | Promise<R>): Promise<R> {
  return Promise.resolve(txAls.run(tx, fn));
}

export function getTxContext(): unknown | undefined {
  return txAls.getStore();
}
