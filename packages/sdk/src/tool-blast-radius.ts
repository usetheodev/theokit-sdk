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

/**
 * A tool that may carry a blast-radius declaration under {@link DECLARED}.
 *
 * The property is OPTIONAL in the type, so a plain tool is assignable to it and the type alone
 * never proves a declaration was made. `describeAction` is what tells the two apart at runtime.
 *
 * @public
 */
export type WithBlastRadius<T> = T & { readonly [DECLARED]?: DeclaredAction };

/**
 * Declare what a tool reaches, for the approval layer rather than for the model.
 *
 * This MUTATES `tool` — it defines a symbol-keyed property on the object it was given and hands
 * the same reference back, so every existing reference to that tool sees the declaration too.
 * Calling it again on the same tool replaces the previous declaration; the property is
 * `configurable`, so re-declaring never throws.
 *
 * The declaration is invisible to `Object.keys` and `JSON.stringify` because the key is a symbol,
 * which is what keeps it out of anything serialised into a prompt.
 *
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
 * Read back the action a tool declared, if any.
 *
 * This is how an approval layer obtains the `action` for `evaluateBlastRadius`. An `undefined`
 * result means nobody has reviewed this tool's reach, which is a different fact from a tool that
 * declared a narrow scope — decide what to do with the unreviewed case explicitly rather than
 * treating it as harmless.
 *
 * @returns the declared action, or `undefined` when the tool never declared one — NOT an empty
 *   action. "Never declared" and "declared as reaching nothing" are different facts, and collapsing
 *   them is how an unreviewed tool passes as harmless.
 * @public
 */
export function describeAction(tool: object): DeclaredAction | undefined {
  return (tool as { [DECLARED]?: DeclaredAction })[DECLARED];
}
