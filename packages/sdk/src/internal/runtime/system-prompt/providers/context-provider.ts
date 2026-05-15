import { escapeBlockBody } from "../escape.js";
import type {
  ContextSourceForAssembly,
  SystemPromptAssemblyContext,
  SystemPromptProvider,
} from "../types.js";

/**
 * Contributes the `<context>` block (ADR D3 / D9).
 *
 * - Drops `excluded` sources.
 * - Truncates per source proportionally when the total exceeds the budget.
 * - Enforces a per-source floor (`MIN_SOURCE_TOKENS`) so a tiny budget shared
 *   across many sources still yields meaningful slices.
 * - Escapes every source body through `escapeBlockBody` before embedding.
 *
 * @internal
 */
export class ContextPromptProvider implements SystemPromptProvider {
  readonly id = "context";
  readonly priority = 10;

  contribute(ctx: SystemPromptAssemblyContext): Promise<string | undefined> {
    if (ctx.contextSnapshot === undefined) return Promise.resolve(undefined);
    const included = ctx.contextSnapshot.sources.filter((src) => src.status === "included");
    if (included.length === 0) return Promise.resolve(undefined);
    const truncated = truncateToBudget(included, ctx.contextMaxTokens);
    if (truncated.length === 0) return Promise.resolve(undefined);
    const body = truncated.map((src) => formatSource(src.name, src.tokens)).join("\n");
    return Promise.resolve(`<context>\n${body}\n</context>`);
  }
}

const MIN_SOURCE_TOKENS = 50;

function truncateToBudget(
  sources: ReadonlyArray<ContextSourceForAssembly>,
  maxTokens: number | undefined,
): Array<{ name: string; tokens: ReadonlyArray<string> }> {
  if (maxTokens === undefined || maxTokens <= 0) {
    return sources.map((src) => ({ name: src.name, tokens: src.tokens }));
  }
  const total = sources.reduce((sum, src) => sum + src.tokens.length, 0);
  if (total <= maxTokens) {
    return sources.map((src) => ({ name: src.name, tokens: src.tokens }));
  }
  const floor = Math.min(MIN_SOURCE_TOKENS, Math.floor(maxTokens / sources.length));
  const remaining = Math.max(0, maxTokens - floor * sources.length);
  return sources.map((src) => {
    const proportional = total === 0 ? 0 : Math.floor((src.tokens.length / total) * remaining);
    const allotted = Math.min(src.tokens.length, floor + proportional);
    return { name: src.name, tokens: src.tokens.slice(0, allotted) };
  });
}

function formatSource(name: string, tokens: ReadonlyArray<string>): string {
  if (tokens.length === 0) {
    return `  <source name="${escapeAttribute(name)}" />`;
  }
  const body = escapeBlockBody(tokens.join(" "));
  return `  <source name="${escapeAttribute(name)}">\n    ${body}\n  </source>`;
}

function escapeAttribute(name: string): string {
  return name.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
