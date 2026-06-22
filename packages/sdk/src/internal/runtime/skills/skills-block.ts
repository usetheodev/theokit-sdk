import { escapeBlockBody } from "../system-prompt/escape.js";

/**
 * Render the `<skills>` system-prompt block from a skill list.
 *
 * Input is the structural subset `{ name, description }` — the skill BODY is
 * NOT in the type, so it cannot leak into the prompt. Both fields are passed
 * through `escapeBlockBody` to neutralise prompt-injection vectors hidden in
 * user-controlled SKILL.md frontmatter (injection-escape ADR).
 *
 * Returns `undefined` for an empty list so the caller can omit the block.
 *
 * Public via `@theokit/sdk/skills`.
 *
 * @public
 */
export function buildSkillsBlock(
  skills: ReadonlyArray<{ name: string; description: string }>,
): string | undefined {
  if (skills.length === 0) return undefined;
  const lines = skills.map(
    (skill) => `  - ${escapeBlockBody(skill.name)}: ${escapeBlockBody(skill.description)}`,
  );
  return `<skills>\n${lines.join("\n")}\n</skills>`;
}
