/**
 * ACI (Agent-Computer Interface) helpers for tools (M3-5).
 *
 * `withDescription(tool, description)` immutably overrides a tool's LLM-facing
 * description (the wording that drives tool-selection accuracy) — returning a
 * NEW `CustomTool` and leaving the original untouched. `renderToolList(tools)`
 * renders a `<tools>` block FROM THE SAME `CustomTool[]` the agent runs, so the
 * rendered list cannot drift from the real tools (single source of truth).
 *
 * Both are pure, zero-dependency, and never throw. The `<tools>` block is a
 * system-prompt orientation aid — NOT the provider tool-call schema (that stays
 * each tool's `inputSchema`). Design: blueprint m3-aci-tools.
 */

import type { CustomTool } from "@theokit/sdk";

/**
 * Return a new `CustomTool` with `description` replaced. Preserves
 * name/inputSchema/handler; does NOT mutate the original tool.
 */
export function withDescription(tool: CustomTool, description: string): CustomTool {
  return {
    name: tool.name,
    description,
    inputSchema: tool.inputSchema,
    handler: tool.handler,
  };
}

/** XML-escape for the `<tools>` block. `&` MUST be replaced first (no double-escape). */
function esc(s: string): string {
  // String() guards the never-throw contract against an untyped/`as any` caller
  // passing a non-string name/description.
  return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** Render mode for {@link renderToolList}. */
export type ToolListMode = "full" | "summary" | "names";

/**
 * Extract the first sentence of a description, abbreviation-safe: a period is
 * only a sentence boundary when followed by whitespace + a capital/paren/EOF, so
 * `e.g.`, `i.e.`, `vs.` do NOT split. Falls back to the whole (trimmed) string.
 */
function firstSentence(d: string): string {
  const m = d.trim().match(/\.\s+(?=[A-Z(]|$)/);
  return m?.index == null ? d.trim() : d.trim().slice(0, m.index + 1);
}

/**
 * Render the agent's actual `CustomTool[]` — single source of truth, so an
 * overridden/added/removed tool is reflected automatically. Never throws.
 *
 * Modes (`options.mode`, default `"full"`):
 * - `"full"`: a `<tools>` XML block (name + description per tool, XML-escaped).
 *   An empty array yields `<tools></tools>`.
 * - `"summary"`: markdown `- name: <first sentence>` per tool (NOT XML-escaped).
 * - `"names"`: markdown `- name` per tool (NOT XML-escaped).
 *
 * Markdown modes on an empty array yield `""`. A non-object `options` arg (e.g. a
 * map index from `tools.map(renderToolList)`) has no `.mode` → falls back to `"full"`.
 */
export function renderToolList(tools: CustomTool[], options?: { mode?: ToolListMode }): string {
  const mode = options?.mode ?? "full";
  if (mode === "summary") {
    return tools.map((t) => `- ${t.name}: ${firstSentence(t.description)}`).join("\n");
  }
  if (mode === "names") {
    return tools.map((t) => `- ${t.name}`).join("\n");
  }
  if (tools.length === 0) return "<tools></tools>";
  const lines = ["<tools>"];
  for (const t of tools) {
    lines.push(
      "  <tool>",
      `    <name>${esc(t.name)}</name>`,
      `    <description>${esc(t.description)}</description>`,
      "  </tool>",
    );
  }
  lines.push("</tools>");
  return lines.join("\n");
}
