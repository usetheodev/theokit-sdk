/**
 * `acp-bridge` — Agent Communication Protocol bridge.
 *
 * Converts TheoCode internal structures to ACP-compatible descriptors.
 */

export interface AcpServiceDescriptor {
  name: string;
  description: string;
  version: string;
}

/**
 * Create a base ACP service descriptor for a TheoCode instance.
 */
export function createAcpDescriptor(name: string): AcpServiceDescriptor {
  return {
    name,
    description: `TheoCode coding agent: ${name}`,
    version: "1.0.0",
  };
}

/**
 * Convert a session to an ACP-compatible record.
 */
export function sessionToAcp(session: { id: string; title: string }): Record<string, unknown> {
  return {
    type: "acp.session",
    id: session.id,
    title: session.title,
  };
}

/**
 * Convert a message to an ACP-compatible record.
 */
export function messageToAcp(msg: { role: string; content: string }): Record<string, unknown> {
  return {
    type: "acp.message",
    role: msg.role,
    content: msg.content,
  };
}

/**
 * Convert a tool invocation event to an ACP-compatible record.
 */
export function toolEventToAcp(
  toolName: string,
  input: unknown,
  output: string,
): Record<string, unknown> {
  return {
    type: "acp.tool_event",
    tool: toolName,
    input,
    output,
  };
}
