import { escapeBlockBody } from "../escape.js";
import type { SystemPromptAssemblyContext, SystemPromptProvider } from "../types.js";

/**
 * Contributes the `<memory>` block (ADR D5 / D9).
 *
 * Each fact's `text` is passed through `escapeBlockBody` before embedding so
 * a persisted fact containing literal `</memory>` cannot escape the block.
 *
 * @internal
 */
export class MemoryPromptProvider implements SystemPromptProvider {
  readonly id = "memory";
  readonly priority = 30;

  contribute(ctx: SystemPromptAssemblyContext): Promise<string | undefined> {
    if (ctx.memoryAutoInject === false) return Promise.resolve(undefined);
    if (ctx.memory.length === 0) return Promise.resolve(undefined);
    const lines = ctx.memory.map((fact) => `  - ${escapeBlockBody(fact.text)}`);
    return Promise.resolve(`<memory>\n${lines.join("\n")}\n</memory>`);
  }
}
