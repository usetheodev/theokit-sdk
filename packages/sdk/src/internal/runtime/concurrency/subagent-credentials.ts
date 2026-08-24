/**
 * theokit#148 — the parent's credentials, delivered through the CALL, not through the tool object.
 *
 * ## The class of bug this replaces
 *
 * Credential inheritance used to ride a property installed on the subagent tool object — first a
 * unique `Symbol()`, then `Symbol.for` after #143. Both are the same shape of contract: "this
 * object will reach the dispatcher with an extra property intact". Nothing enforces that, and it
 * broke twice for two different reasons:
 *
 *  - **Module duplication** (#142/#143): `tsup splitting: false` inlined a separate copy of the
 *    module into each public entry, so the two copies disagreed on a unique `Symbol()` key. Fixed at
 *    the build level by M78's `splitting: true`, but the fragile contract remained.
 *  - **Object normalization** (#148): any layer that rebuilds the tool from its known fields drops
 *    the property. `@theokit/agents`' `toCompiledTool` does exactly that, and had to add an explicit
 *    `Object.getOwnPropertySymbols` copy loop to compensate — a band-aid the SDK's contract forced
 *    onto a consumer. A named field would have been dropped by the same four-field rebuild, which is
 *    why "make it a typed field" alone does not close this.
 *
 * ## Why the async scope closes it
 *
 * What survives a rebuild is not the object — it is the CALL. A normalizing wrapper builds a new
 * object but still invokes the original handler, inside the parent run's async context. So
 * credentials published on that context reach the handler regardless of what the tool object looks
 * like by then. There is no property left for a layer to drop.
 *
 * It also fixes a defect the per-object slot could not: credentials were stored per tool INSTANCE,
 * so one subagent tool shared by two agents got last-writer-wins. The scope is per run.
 *
 * Nothing is exposed to third-party tool code: the store is module-private, credentials never touch
 * a handler's `ctx`, and `currentInheritedSubAgentCredentials` is `@internal`.
 *
 * @internal
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { ModelSelection } from "../../../types/agent-prims.js";
import type { Plugin } from "../../plugins/types.js";

/**
 * Credentials a parent agent hands down to its subagent tools so the child inherits the parent's
 * auth (and, absent an explicit `spec.model`, its model).
 *
 * Declared here rather than in `a2a/subagent.ts` so the delivery mechanism owns the payload shape
 * and the dependency runs one way (`a2a/subagent` -> this module). `a2a/subagent.ts` briefly
 * re-exported it "for back-compat"; knip proved there was no back-compat surface to preserve — the
 * type was never in the public barrel nor the exports map — so the re-export was deleted.
 *
 * Emitted rather than erased: `a2a/subagent.d.ts` imports it by name, and that entry IS published,
 * so erasing this declaration ships a `.d.ts` that does not compile. Not being in the exports map
 * is what keeps it out of the semver contract; erasure is not what does that.
 */
export interface InheritedCredentials {
  readonly apiKey?: string;
  readonly model?: ModelSelection;
  /**
   * The parent's shell-sandbox posture (`local.sandboxOptions.enabled`), handed down so a delegated
   * child of a sandboxed parent stays sandboxed unless its role explicitly opts out. Without this a
   * child ran unsandboxed whenever its role omitted `sandbox` — a default-open the sandbox wiring
   * exists to prevent.
   */
  readonly sandbox?: boolean;
  /**
   * #55 — the parent's code-registered plugins (e.g. a `PermissionPlugin`) handed down so the child
   * runs under the SAME policy. Without this, a delegated child's inner tool calls escape the
   * parent's argument-level permission gate. First-party delegation path only — never exposed to
   * third-party tool `ctx`.
   */
  readonly plugins?: readonly Plugin[];
}

const credentialsStore = new AsyncLocalStorage<InheritedCredentials>();

/**
 * Run `fn` with `credentials` published as the delegation credentials of the current run.
 *
 * Nested scopes shadow the outer one and the outer is restored on return, so a delegated child that
 * itself delegates hands down ITS credentials, not its parent's.
 *
 * @internal
 */
export async function withInheritedSubAgentCredentials<T>(
  credentials: InheritedCredentials,
  fn: () => Promise<T>,
): Promise<T> {
  return credentialsStore.run(credentials, fn);
}

/**
 * The delegation credentials of the current run, or `undefined` outside a run scope.
 *
 * `undefined` is deliberately NOT a fallback to some previous run's value: a subagent dispatched
 * with no parent context must create its child without an inherited key rather than reuse a
 * credential that belonged to someone else.
 *
 * @internal
 */
export function currentInheritedSubAgentCredentials(): InheritedCredentials | undefined {
  return credentialsStore.getStore();
}
