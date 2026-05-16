import { ConfigurationError } from "../../../errors.js";
import { ActiveMemoryPromptProvider } from "./providers/active-memory-provider.js";
import { BasePromptProvider } from "./providers/base-provider.js";
import { ContextPromptProvider } from "./providers/context-provider.js";
import { MemoryPromptProvider } from "./providers/memory-provider.js";
import { SkillsPromptProvider } from "./providers/skills-provider.js";
import { safeCall } from "./safe-call.js";
import type { SystemPromptAssemblyContext, SystemPromptProvider } from "./types.js";

/**
 * System-prompt assembly pipeline (ADR D8 — Strategy + Chain of
 * Responsibility additive).
 *
 * Sorts providers by `priority` ascending (lexicographic `id` tiebreak),
 * invokes each `contribute` sequentially through `safeCall`, filters
 * `undefined` / empty contributions, and joins the rest with a double
 * newline.
 *
 * Constructor rejects duplicate `(priority, id)` provider keys with
 * `ConfigurationError` code `pipeline_duplicate_provider` (EC-2).
 *
 * @internal
 */
export class SystemPromptPipeline {
  readonly providers: ReadonlyArray<SystemPromptProvider>;

  constructor(providers: ReadonlyArray<SystemPromptProvider>) {
    const seen = new Set<string>();
    for (const p of providers) {
      const key = `${p.priority}:${p.id}`;
      if (seen.has(key)) {
        throw new ConfigurationError(`Duplicate system-prompt provider ${key}`, {
          code: "pipeline_duplicate_provider",
        });
      }
      seen.add(key);
    }
    this.providers = [...providers].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }

  async assemble(ctx: SystemPromptAssemblyContext): Promise<string | undefined> {
    const parts: string[] = [];
    for (const provider of this.providers) {
      const contribution = await safeCall(
        () => provider.contribute(ctx),
        undefined,
        `system-prompt provider "${provider.id}"`,
      );
      if (contribution === undefined || contribution.length === 0) continue;
      parts.push(contribution);
    }
    return parts.length === 0 ? undefined : parts.join("\n\n");
  }

  /**
   * Default factory — wires the four built-in providers. Phase 3 ships
   * `BasePromptProvider`; Phases 3.2 / 4 / 5 register Context / Skills /
   * Memory by editing THIS factory and adding nothing else.
   */
  static default(): SystemPromptPipeline {
    return new SystemPromptPipeline([
      new ActiveMemoryPromptProvider(),
      new ContextPromptProvider(),
      new SkillsPromptProvider(),
      new MemoryPromptProvider(),
      new BasePromptProvider(),
    ]);
  }
}
