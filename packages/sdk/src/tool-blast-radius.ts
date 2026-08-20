/**
 * Attach a blast-radius declaration to a tool, so the approval layer gates on what the tool DOES.
 *
 * Without this the only key available to a policy is the tool's NAME, which says nothing about the
 * action, drifts the moment a tool is renamed, and cannot be reviewed by anyone who did not write
 * it. `delete_namespace` and `list_pods` differ by a word.
 *
 * ## Why a wrapper rather than a field on the input schema
 *
 * `inputSchema` is what the MODEL sees. Blast radius is not for the model — it is for the approval
 * layer — and putting it there would leak policy into the prompt and let a model-authored argument
 * influence its own gate. The declaration rides alongside the tool instead, under a symbol so it
 * cannot collide with a tool's own properties or be serialised into a prompt by accident.
 *
 * @public
 */

import type { DeclaredAction } from "./blast-radius.js";

/**
 * Symbol-keyed on purpose. THAT is what keeps the declaration out of a prompt: `Object.keys` and
 * `JSON.stringify` both ignore symbol keys, so a tool serialised on its way to the model carries
 * none of it. A string key would also risk colliding with a property the tool already has.
 *
 * Exported because the `@public` `WithBlastRadius<T>` below uses it as a COMPUTED
 * KEY. A computed key is part of the type it keys, so the emitted declaration
 * names this const — and a name the declaration file does not carry is a broken
 * reference (#335). `Symbol.for` keeps it a registry symbol, so an exported
 * binding does not weaken the property-hiding this comment describes: the value
 * was always retrievable by any code that knows the string.
 *
 * @public
 */
export const DECLARED: unique symbol = Symbol.for("@theokit/sdk.blastRadius") as typeof DECLARED;

/** @public */
export type WithBlastRadius<T> = T & { readonly [DECLARED]?: DeclaredAction };

/**
 * @returns the same tool, with its action declared. The tool is not otherwise altered — the model
 *   must see exactly what it saw before.
 * @public
 */
export function withBlastRadius<T extends object>(
  tool: T,
  action: DeclaredAction,
): WithBlastRadius<T> {
  return Object.defineProperty(tool, DECLARED, {
    value: action,
    // `enumerable: false` is defensive and NOT load-bearing — checked, not assumed. Flipping it to
    // true leaves every case green, because the symbol key already excludes this from `Object.keys`
    // and `JSON.stringify`. It stays because a future string-keyed variant would need it, and the
    // next reader should not have to discover that the flag has no test behind it.
    enumerable: false,
    configurable: true,
  }) as WithBlastRadius<T>;
}

/**
 * @returns the declared action, or `undefined` when the tool never declared one — NOT an empty
 *   action. "Never declared" and "declared as reaching nothing" are different facts, and collapsing
 *   them is how an unreviewed tool passes as harmless.
 * @public
 */
export function describeAction(tool: object): DeclaredAction | undefined {
  return (tool as { [DECLARED]?: DeclaredAction })[DECLARED];
}
