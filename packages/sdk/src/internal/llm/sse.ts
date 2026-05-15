/**
 * Minimal Server-Sent-Events parser. Consumes a fetch `Response` body
 * stream and yields `{ event, data }` records as they arrive. Used by
 * both the Anthropic and OpenAI streaming clients — neither vendor sends
 * binary SSE so a simple text decoder is enough.
 *
 * @internal
 */

export interface SseRecord {
  event: string;
  data: string;
}

interface ParserState {
  buffer: string;
  event: string;
  data: string;
}

export async function* parseSseStream(
  body: ReadableStream<Uint8Array> | null,
  signal: AbortSignal,
): AsyncGenerator<SseRecord, void, void> {
  if (body === null) return;
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  const state: ParserState = { buffer: "", event: "message", data: "" };
  try {
    while (true) {
      if (signal.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      state.buffer += decoder.decode(value, { stream: true });
      for (const record of drainCompleteRecords(state)) yield record;
    }
    if (state.data.length > 0) yield { event: state.event, data: state.data };
  } finally {
    releaseReader(reader);
  }
}

function drainCompleteRecords(state: ParserState): SseRecord[] {
  const out: SseRecord[] = [];
  let newlineIndex = state.buffer.indexOf("\n");
  while (newlineIndex !== -1) {
    const line = state.buffer.slice(0, newlineIndex).replace(/\r$/, "");
    state.buffer = state.buffer.slice(newlineIndex + 1);
    const finished = applyLine(state, line);
    if (finished !== undefined) out.push(finished);
    newlineIndex = state.buffer.indexOf("\n");
  }
  return out;
}

function applyLine(state: ParserState, line: string): SseRecord | undefined {
  if (line === "") {
    if (state.data.length === 0) {
      state.event = "message";
      return undefined;
    }
    const record: SseRecord = { event: state.event, data: state.data };
    state.event = "message";
    state.data = "";
    return record;
  }
  if (line.startsWith(":")) return undefined;
  if (line.startsWith("event:")) {
    state.event = line.slice(6).trim();
    return undefined;
  }
  if (line.startsWith("data:")) {
    const piece = line.slice(5).trim();
    state.data = state.data.length === 0 ? piece : `${state.data}\n${piece}`;
  }
  return undefined;
}

function releaseReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    reader.releaseLock();
  } catch {
    // already released
  }
}
