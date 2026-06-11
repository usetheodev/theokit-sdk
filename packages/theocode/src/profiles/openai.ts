import { BASE_INSTRUCTIONS } from "./base.js";
import type { PromptProfile } from "./types.js";

/**
 * GPT-tuned prompt profile.
 * Leverages OpenAI's strengths: JSON mode, function calling syntax,
 * and structured output via response_format.
 */
export const openaiProfile: PromptProfile = {
  name: "openai",
  systemPrompt: `${BASE_INSTRUCTIONS}

Provider hints (GPT):
- JSON mode is available — use it when returning structured data.
- Use function calling syntax for tool invocations.
- For structured output, leverage response_format when the caller supports it.
- Be explicit about file paths — always use absolute paths in tool calls.
- When generating code, prefer complete functions over partial snippets.`,
  reminderPrompt:
    "Remember: read before editing, run tests after changes, use JSON for structured output.",
  maxSteps: 60,
};
