import { BASE_INSTRUCTIONS } from "./base.js";
import type { PromptProfile } from "./types.js";

/**
 * Claude-tuned prompt profile.
 * Leverages Claude's strengths: XML-structured output, extended thinking,
 * and artifact-style code blocks for long content.
 */
export const anthropicProfile: PromptProfile = {
  name: "anthropic",
  systemPrompt: `${BASE_INSTRUCTIONS}

Provider hints (Claude):
- Use <thinking> blocks to reason through complex problems before acting.
- Prefer XML tags (e.g. <file>, <change>) for structured tool output when helpful.
- For long code output, use artifacts — present complete files rather than diffs when clarity matters.
- You have extended context — use it to read multiple files before proposing changes.
- Chain tool calls efficiently: batch independent reads in one turn.`,
  reminderPrompt:
    "Remember: read before editing, run tests after changes, use XML tags for structured output.",
  maxSteps: 80,
};
