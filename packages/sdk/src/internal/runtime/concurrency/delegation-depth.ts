/**
 * #364 — how deep the current delegation chain already is, delivered through the CALL.
 *
 * ## The bug this replaces
 *
 * `maxDelegationDepth` was checked once, at tool-CONSTRUCTION time, against a `_parentDepth`
 * argument that nothing in the SDK ever incremented. Constructing a tool says nothing about how
 * deep it will later be invoked, so with the documented call — `SubAgent.create(spec)` — the test
 * was `1 > maxDepth`, false for every spec that did not ask for depth 0. A subagent whose tools
 * include another subagent recursed unbounded, which is precisely what the guard exists to stop.
 * The only path that ever tripped it was a caller threading the number by hand.
 *
 * ## Why the async scope closes it
 *
 * Depth is a property of the RUN, not of the object. A child's run loop — and therefore every tool
 * it dispatches — executes inside the async continuation of its parent's handler, so a value
 * published on that context is exactly what a nested dispatch needs to read. This is the same seam
 * `subagent-credentials.ts` uses, and for the same reason: what survives every layer that rebuilds
 * a tool object is the call, never the object.
 *
 * It is kept in its own module rather than folded into the credentials payload because depth is a
 * separate concern with a separate lifetime — the credentials scope is opened once per run by the
 * run loop, while depth is opened per delegation by the dispatching tool.
 *
 * @internal
 */

import { AsyncLocalStorage } from "node:async_hooks";

const depthStore = new AsyncLocalStorage<number>();

/**
 * Run `fn` with `depth` published as the delegation depth of the current chain.
 *
 * Nested scopes shadow the outer one and the outer is restored on return, so two sibling
 * delegations from the same parent each start from the parent's depth rather than from each
 * other's.
 *
 * @internal
 */
export async function withDelegationDepth<T>(depth: number, fn: () => Promise<T>): Promise<T> {
  return depthStore.run(depth, fn);
}

/**
 * The delegation depth of the current chain — `0` outside any delegation.
 *
 * `0` is the honest default rather than a fallback to some previous chain's value: a subagent
 * dispatched with no parent delegation IS at depth zero.
 *
 * @internal
 */
export function currentDelegationDepth(): number {
  return depthStore.getStore() ?? 0;
}
