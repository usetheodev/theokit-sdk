/**
 * performPersonalitySwitch — orchestrates the full lifecycle of a
 * personality activation: store mutation, optional history reset,
 * transcript marker injection, and cache invalidation (T5.1, ADR D164).
 *
 * The marker is emitted as a **user role** message because (a) the
 * switch is a directive from the operator (not a model utterance), and
 * (b) LLMs treat user-role lines as instructions that survive history
 * compaction (EC-D from arXiv:2412.00804).
 *
 * Same-slug switches are no-ops: no marker, no cache invalidation, no
 * store write (EC-18).
 *
 * @internal
 */

import { ConfigurationError } from "../../errors.js";
import { PersonalityRegistry } from "./registry.js";
import type { PersonalityStore } from "./store.js";
import type { PersonalityPreset } from "./types.js";

export interface PerformPersonalitySwitchArgs {
  agentId: string;
  /** Previous active slug (undefined = no active preset). */
  prevSlug: string | undefined;
  /** Next active slug or reserved clear alias (none / default / neutral). */
  requestedName: string;
  registry: PersonalityRegistry;
  store: PersonalityStore;
  invalidateCache: (reason: string) => Promise<void>;
  appendSessionMessage: (msg: { role: "user" | "assistant"; text: string }) => void;
  clearSession?: () => void;
  opts: { save?: boolean; reset?: boolean };
}

/**
 * Run the full personality-switch lifecycle. Returns the new preset
 * (or null when cleared). Throws `ConfigurationError` on unknown name.
 *
 * @internal
 */
export async function performPersonalitySwitch(
  args: PerformPersonalitySwitchArgs,
): Promise<PersonalityPreset | null> {
  const reserved = PersonalityRegistry.isReservedClearSlug(args.requestedName);
  let nextSlug: string | undefined;
  let resolved: PersonalityPreset | null;

  if (reserved) {
    nextSlug = undefined;
    resolved = null;
  } else {
    const preset = args.registry.get(args.requestedName);
    if (preset === undefined) {
      const available =
        args.registry
          .all()
          .map((p) => p.name)
          .join(", ") || "(none)";
      throw new ConfigurationError(
        `Personality "${args.requestedName}" not found. Available: ${available}`,
        { code: "personality_not_found" },
      );
    }
    nextSlug = preset.name;
    resolved = preset;
  }

  // EC-18: same slug = no-op.
  if (args.prevSlug === nextSlug) return resolved;

  await args.store.setActive(args.agentId, nextSlug, { save: args.opts.save === true });

  // EC-19: reset BEFORE marker so marker is first in the new session.
  if (args.opts.reset === true && args.clearSession !== undefined) {
    args.clearSession();
  }

  const marker = nextSlug === undefined ? "[persona cleared]" : `[persona switched to ${nextSlug}]`;
  args.appendSessionMessage({ role: "user", text: marker });

  await args.invalidateCache("personality-switch");
  return resolved;
}
