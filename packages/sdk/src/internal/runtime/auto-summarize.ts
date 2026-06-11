/**
 * Auto-summarization trigger — thin layer over existing compression pipeline.
 *
 * Per ADR D4: reuses `compressConversationWindow()` from the existing
 * compression pipeline. Only adds the fraction-based trigger logic.
 * EC-3: guards against messages.length <= keepNewest.
 * EC-8: guards against maxContextTokens <= 0.
 *
 * @internal
 */

export interface AutoSummarizeConfig {
  triggerFraction: number;
  keepNewest: number;
  model?: string;
}

export interface CompressibleMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

const DEFAULT_TRIGGER_FRACTION = 0.85;
const DEFAULT_KEEP_NEWEST = 4;

export function resolveAutoSummarizeConfig(
  partial?: Partial<AutoSummarizeConfig>,
): AutoSummarizeConfig {
  return {
    triggerFraction: partial?.triggerFraction ?? DEFAULT_TRIGGER_FRACTION,
    keepNewest: partial?.keepNewest ?? DEFAULT_KEEP_NEWEST,
    model: partial?.model,
  };
}

export function shouldSummarize(
  totalTokens: number,
  maxContextTokens: number,
  config: AutoSummarizeConfig,
): boolean {
  // EC-8: guard against division by zero
  if (maxContextTokens <= 0) return false;
  return totalTokens / maxContextTokens >= config.triggerFraction;
}

export async function autoSummarize(opts: {
  messages: CompressibleMessage[];
  config: AutoSummarizeConfig;
  callLlm: (model: string, system: string, user: string) => Promise<string>;
}): Promise<CompressibleMessage[]> {
  // EC-3: nothing to compress if fewer messages than keepNewest
  if (opts.messages.length <= opts.config.keepNewest) {
    return opts.messages;
  }

  const keep = opts.messages.slice(-opts.config.keepNewest);
  const toCompress = opts.messages.slice(0, -opts.config.keepNewest);

  const conversationText = toCompress.map((m) => `${m.role}: ${m.content}`).join("\n\n");

  const model = opts.config.model ?? "claude-sonnet-4-20250514";

  const summaryText = await opts.callLlm(
    model,
    "You are a conversation summarizer. Produce a concise summary of the conversation preserving key facts, decisions, and action items. Output only the summary, no preamble.",
    conversationText,
  );

  const summaryMessage: CompressibleMessage = {
    role: "system",
    content: `[Conversation summary]\n${summaryText}`,
  };

  return [summaryMessage, ...keep];
}
