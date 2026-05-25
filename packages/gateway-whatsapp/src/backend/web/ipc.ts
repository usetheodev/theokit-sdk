/**
 * IPC protocol between adapter and `whatsapp-web.js` subprocess bridge.
 *
 * Wire: stdin/stdout JSON-lines (each message terminated by `\n`).
 *
 * @internal
 */

/**
 * Sentinel runtime export — see `backend-types.ts` for rationale.
 *
 * @knipignore
 */
export const __ipcMarker: unique symbol = Symbol("ipc");

/** Commands the adapter sends to the bridge. */
export type IpcCommand =
  | { readonly cmd: "send"; readonly msgId: string; readonly to: string; readonly text: string }
  | { readonly cmd: "shutdown" };

/** Events the bridge emits to the adapter. */
export type IpcEvent =
  | { readonly event: "ready"; readonly botPhone: string }
  | {
      readonly event: "message";
      readonly msgId: string;
      readonly from: string;
      readonly body: string;
      readonly isGroup: boolean;
      readonly chatId: string;
      readonly contactName?: string;
      readonly timestamp: number;
    }
  | {
      readonly event: "send_ack";
      readonly msgId: string;
      readonly success: boolean;
      readonly wamid?: string;
      readonly error?: string;
    }
  | {
      readonly event: "status";
      readonly msgId: string;
      readonly status: "sent" | "delivered" | "read" | "failed";
      readonly recipient: string;
      readonly timestamp: number;
    }
  | { readonly event: "error"; readonly message: string };

/** Parse one JSON-line. Returns null on malformed. */
export function parseEvent(line: string): IpcEvent | null {
  if (line.length === 0) return null;
  try {
    const parsed = JSON.parse(line) as unknown;
    if (parsed === null || typeof parsed !== "object") return null;
    if (typeof (parsed as { event?: unknown }).event !== "string") return null;
    return parsed as IpcEvent;
  } catch {
    return null;
  }
}

/** Format an outbound command as JSON + newline. */
export function formatCommand(cmd: IpcCommand): string {
  return `${JSON.stringify(cmd)}\n`;
}

/**
 * Line buffer — accumulates stdout chunks until `\n` boundaries, yields
 * complete lines. Addresses EC-11 (chunked stdout across multiple reads).
 */
export class LineBuffer {
  private buffer = "";

  push(chunk: string): string[] {
    this.buffer += chunk;
    const out: string[] = [];
    let idx = this.buffer.indexOf("\n");
    while (idx !== -1) {
      out.push(this.buffer.slice(0, idx));
      this.buffer = this.buffer.slice(idx + 1);
      idx = this.buffer.indexOf("\n");
    }
    return out;
  }

  /** Test seam — current pending bytes. */
  get pending(): string {
    return this.buffer;
  }
}
