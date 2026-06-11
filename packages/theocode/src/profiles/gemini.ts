import { BASE_INSTRUCTIONS } from "./base.js";
import type { PromptProfile } from "./types.js";

/**
 * Gemini-tuned prompt profile.
 * Leverages Gemini's strengths: grounding with search, code execution,
 * and multimodal input.
 */
export const geminiProfile: PromptProfile = {
  name: "gemini",
  systemPrompt: `${BASE_INSTRUCTIONS}

Provider hints (Gemini):
- Grounding with search is available for verifying facts — use it when unsure about APIs or library versions.
- Code execution is supported — use it to validate snippets before writing them to files.
- Multimodal input is supported — you can process images and diagrams if provided.
- Be explicit with imports and types — avoid implicit globals.
- Prefer step-by-step tool use over long monolithic responses.`,
  reminderPrompt:
    "Remember: read before editing, run tests after changes, use grounding to verify facts.",
  maxSteps: 60,
};
