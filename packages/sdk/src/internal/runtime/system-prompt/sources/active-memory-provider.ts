import { escapeBlockBody } from "../escape.js";
import type { SystemPromptAssemblyContext, SystemPromptProvider } from "../types.js";

/**
 * Contributes the `<active-memory>` block (ADR D6 of memory-system-openclaw-parity).
 *
 * Priority 5 — fires BEFORE Context/Skills/Memory providers so the recall
 * summary sits at the top of the system prompt. The summary itself is
 * produced by `runActiveMemory` and threaded via
 * `SystemPromptAssemblyContext.activeMemorySummary`.
 *
 * @internal
 */
export class ActiveMemoryPromptProvider implements SystemPromptProvider {
  readonly id = "active-memory";
  readonly priority = 5;

  contribute(ctx: SystemPromptAssemblyContext): Promise<string | undefined> {
    if (ctx.activeMemorySummary === undefined || ctx.activeMemorySummary.length === 0) {
      return Promise.resolve(undefined);
    }
    const body = escapeBlockBody(ctx.activeMemorySummary);
    return Promise.resolve(`<active-memory>\n${body}\n</active-memory>`);
  }
}
