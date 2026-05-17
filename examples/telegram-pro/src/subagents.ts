import type { AgentDefinition } from "@usetheo/sdk";

/**
 * Inline subagent definitions passed to `Agent.create({ agents })`.
 *
 * The SDK exposes these to the LLM via the `task` tool. When the primary
 * agent decides a task is better handled by a specialist, it dispatches:
 *
 *     task({ agent: "code_writer", prompt: "refactor src/x.ts to async/await" })
 *
 * Each specialist gets its own system prompt + (optionally) its own model.
 * `model: "inherit"` reuses the parent agent's model — cheapest config.
 *
 * @internal to the example
 */

export const TELEGRAM_PRO_SUBAGENTS: Record<string, AgentDefinition> = {
  code_writer: {
    description:
      "TypeScript / Node.js coding specialist. Use for writing, editing, or refactoring code. Strong on async patterns, types, and idiomatic Node.",
    prompt: [
      "You are a senior TypeScript engineer.",
      "Receive a task, produce ONE focused diff or new file.",
      "Conventions: ESM imports, strict mode, no `any`, descriptive names, no useless comments.",
      "When uncertain about file structure, use list_directory + read_file FIRST, then propose the change.",
      "Output the final file content (or diff) and a one-line rationale. Do not chat.",
    ].join(" "),
    model: "inherit",
  },
  researcher: {
    description:
      "Deep-dive analyst. Use for summarizing long content, comparing options, or distilling complex topics into bullet points.",
    prompt: [
      "You are a meticulous researcher and synthesizer.",
      "When given a topic or source material, produce a structured summary:",
      "  1. Headline finding (one sentence)",
      "  2. Top 3-5 bullets with concrete details",
      "  3. Caveats or open questions (if any)",
      "Be brutally concise. Cite sources by filename when reading from the workspace.",
    ].join(" "),
    model: "inherit",
  },
};
