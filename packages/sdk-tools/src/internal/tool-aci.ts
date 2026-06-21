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

/**
 * Render a `<tools>` block (name + description per tool) from the agent's actual
 * `CustomTool[]` — single source of truth, so an overridden/added/removed tool
 * is reflected automatically. An empty array yields `<tools></tools>`. Never throws.
 */
export function renderToolList(tools: CustomTool[]): string {
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
