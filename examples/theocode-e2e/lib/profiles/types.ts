/**
 * Shape of a prompt profile that tunes agent behavior for a specific LLM provider.
 */
export interface PromptProfile {
  /** Human-readable name (e.g. "anthropic", "openai", "default"). */
  name: string;

  /** Full system prompt injected at session start. */
  systemPrompt: string;

  /** Optional reminder appended after long conversations. */
  reminderPrompt?: string;

  /** Provider-specific max steps hint (overridable by caller). */
  maxSteps?: number;
}
