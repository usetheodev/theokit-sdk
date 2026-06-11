import { BASE_INSTRUCTIONS } from "./base.js";
import type { PromptProfile } from "./types.js";

/**
 * Default profile used when the model provider cannot be identified.
 * Adds no provider-specific hints beyond the base instructions.
 */
export const defaultProfile: PromptProfile = {
  name: "default",
  systemPrompt: `${BASE_INSTRUCTIONS}

Use the tools provided to read, search, edit, and write files.
Structure your output as plain text — avoid provider-specific formatting unless instructed.`,
  maxSteps: 50,
};
