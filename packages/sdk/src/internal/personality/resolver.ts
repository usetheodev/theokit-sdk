/**
 * createPersonalityResolver — bridges {@link PersonalityRegistry} and
 * {@link PersonalityStore} to the agent's `SystemPromptResolver` hook
 * (T3.1, ADR D160).
 *
 * The resolver is **pure** — it never mutates registry or store. It reads
 * the active personality slug for the calling agent and overlays the
 * preset body onto the user-provided base prompt.
 *
 * Composition:
 *
 * ```
 * [base prompt (if any)] + separator + [personality body (if active)]
 * ```
 *
 * Edge cases:
 *
 * - **EC-F:** `ctx.agentId` empty/undefined → resolver returns the base
 *   unchanged (store lookup returns undefined; no overlay, no crash).
 * - **EC-9:** If `baseSystemPrompt` is itself a resolver and throws, the
 *   error propagates (caller decides).
 * - **EC-10:** Personality body trailing whitespace is preserved
 *   (markdown conformance).
 * - **EC-11:** Empty base string "" → personality body alone, no leading
 *   separator.
 * - **EC-L (documented):** `separator: ""` merges base+body without
 *   space — caller's responsibility; we never normalize.
 *
 * If the active slug exists in store but is missing from the registry
 * (e.g., file deleted at runtime) → log warn once + drop overlay.
 *
 * @internal
 */

import type { SystemPromptContext, SystemPromptResolver } from "../../types/agent.js";
import { warnOnce } from "../runtime/hooks/hooks-source.js";
import type { PersonalityRegistry } from "./registry.js";
import type { PersonalityStore } from "./store.js";

/**
 * Options accepted by {@link createPersonalityResolver}.
 *
 * @internal
 */
export interface PersonalityResolverOptions {
  /**
   * Optional base prompt. If a string, used verbatim. If a function,
   * called with the resolver context and awaited. If absent, only the
   * personality body is returned (or empty string when no active preset).
   */
  baseSystemPrompt?: string | SystemPromptResolver;
  /**
   * Separator inserted between base and personality body. Default is
   * `"\n\n"`. **EC-L:** an empty string merges without space — caller's
   * responsibility.
   */
  separator?: string;
}

const DEFAULT_SEPARATOR = "\n\n";

/**
 * Build a {@link SystemPromptResolver} that overlays the active
 * personality preset onto a base prompt.
 *
 * @internal
 */
export function createPersonalityResolver(
  registry: PersonalityRegistry,
  store: PersonalityStore,
  opts?: PersonalityResolverOptions,
): SystemPromptResolver {
  const separator = opts?.separator ?? DEFAULT_SEPARATOR;
  const base = opts?.baseSystemPrompt;

  return async (ctx: SystemPromptContext): Promise<string> => {
    const baseText = await resolveBase(base, ctx);

    // EC-F: empty/missing agentId → no overlay possible (store keyed by agentId).
    if (ctx.agentId === undefined || ctx.agentId === "" || ctx.agentId === null) {
      return baseText;
    }

    const slug = store.active(ctx.agentId);
    if (slug === undefined) return baseText;

    const preset = registry.get(slug);
    if (preset === undefined) {
      // Slug recorded in store but no preset on disk anymore — drop overlay.
      warnOnce(
        `personality-slug-missing-${slug}`,
        `[theokit-sdk] active personality "${slug}" not found in registry; dropping overlay`,
      );
      return baseText;
    }

    // EC-11: empty base → no leading separator.
    if (baseText.length === 0) return preset.systemPrompt;
    return `${baseText}${separator}${preset.systemPrompt}`;
  };
}

async function resolveBase(
  base: string | SystemPromptResolver | undefined,
  ctx: SystemPromptContext,
): Promise<string> {
  if (base === undefined) return "";
  if (typeof base === "string") return base;
  return await base(ctx);
}
