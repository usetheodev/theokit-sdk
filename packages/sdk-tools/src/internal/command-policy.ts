/**
 * Composable command-permission policy layer (M3-6).
 *
 * A `CommandPolicy` is a pure predicate returning a deny REASON (or `null` to
 * allow). `denyCatastrophicCommands()` COMPOSES the M3-2 `catastrophicShellReason`
 * guardrail (it does not duplicate the deny-list). `commandDenialReason` combines
 * a policy array with deny-wins semantics (the first policy returning a reason
 * denies); an empty array denies nothing. `isCommandAllowed` is the boolean view.
 *
 * Framework-agnostic: a consumer wires it at their permission layer — e.g. inside
 * an ACP `pre_tool_call` hook — `@theokit/agents` is not required. Inherits the
 * M3-2 honesty: a heuristic gate, not a sandbox. Design: blueprint m3-command-policy.
 */

import { catastrophicShellReason } from "./shell-guard.js";

/**
 * A pure command-permission predicate: returns a non-empty deny reason, or `null`
 * to allow. NOTE: return `null` to allow — NOT `""`. An empty string is treated
 * as a deny with a blank reason (`"" !== null`), which is almost never intended.
 */
export type CommandPolicy = (command: string) => string | null;

/** A policy that denies catastrophic commands by composing the M3-2 guardrail. */
export function denyCatastrophicCommands(): CommandPolicy {
  return (command) => catastrophicShellReason(command);
}

/**
 * The first deny reason across `policies` (deny-wins), or `null` if every policy
 * allows. An empty `policies` array denies nothing (returns `null`).
 */
export function commandDenialReason(command: string, policies: CommandPolicy[]): string | null {
  for (const policy of policies) {
    const reason = policy(command);
    if (reason !== null) return reason;
  }
  return null;
}

/** `true` when no policy denies `command` (an empty policy array allows everything). */
export function isCommandAllowed(command: string, policies: CommandPolicy[]): boolean {
  return commandDenialReason(command, policies) === null;
}
