/**
 * Message formatting logic for TheoCode TUI.
 *
 * Converts raw message data into display-ready structures that a
 * renderer (Ink / blessed / raw ANSI) can paint directly.
 */

import type { Theme } from "./theme.js";

export interface DisplayMessage {
  role: string;
  content: string;
  timestamp: number;
  toolName?: string;
}

export interface FormattedMessage {
  prefix: string;
  body: string;
  color: string;
}

const ROLE_PREFIX: Record<string, string> = {
  user: "You",
  assistant: "Theo",
  system: "System",
  tool: "Tool",
};

/**
 * Format a single chat message for display.
 */
export function formatMessageForDisplay(msg: DisplayMessage, theme: Theme): FormattedMessage {
  const prefix = msg.toolName ? `[${msg.toolName}]` : (ROLE_PREFIX[msg.role] ?? msg.role);

  let color: string;
  switch (msg.role) {
    case "user":
      color = theme.userPrefix;
      break;
    case "assistant":
      color = theme.assistantPrefix;
      break;
    case "system":
      color = theme.systemPrefix;
      break;
    default:
      color = theme.muted;
  }

  return { prefix, body: msg.content, color };
}

export interface FormattedToolResult {
  prefix: string;
  body: string;
}

/**
 * Format a tool execution result for display.
 */
export function formatToolResult(
  toolName: string,
  output: string,
  status: string,
): FormattedToolResult {
  const statusTag = status === "success" ? "[OK]" : `[${status.toUpperCase()}]`;
  return {
    prefix: `${statusTag} ${toolName}`,
    body: output,
  };
}
