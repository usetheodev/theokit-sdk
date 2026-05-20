# `@usetheo/react` SSE wire format — Vercel AI Data Stream v1

This document is the **source of truth** at the release version of this
package for the SSE protocol emitted by `streamTheoChat` and consumed by
`useTheoChat`. It mirrors the Vercel AI SDK Data Stream v1 spec at the
time of writing (Vercel AI v4). When Vercel ships v2 or changes codes,
we either follow (and update this file) or fork (and document the
divergence).

## Transport

- Content-Type: `text/event-stream`
- Cache-Control: `no-cache`
- Connection: `keep-alive`
- X-Vercel-AI-Data-Stream: `v1` (informational header)
- Encoding: UTF-8, one record per line, newline-terminated.

## Record format

Each line is `<code>:<json>\n`. The code is one ASCII character, the
JSON is a single JSON value. Whitespace is significant — DO NOT pretty-
print or insert blank lines.

| Code | Payload type | Meaning |
|------|--------------|---------|
| `0`  | string | Text delta. Append to current assistant message content. |
| `9`  | object `{ toolCallId, toolName, args? }` | Tool call started. |
| `a`  | object `{ toolCallId, result }` | Tool call completed. |
| `d`  | object `{ finishReason, usage? }` | Finish event. Terminates the stream. |
| `3`  | string | Stream-level error. HTTP status remains 200; the protocol surfaces the error. |
| `o`  | object `{ partial, attempt }` | Partial object delta from `streamObject` (ADR D45). |
| `O`  | object `{ object }` | Complete (final) object from `streamObject` (ADR D45). |

**Order constraint (ADR D45):** in a `streamAssistant` response, `o:` events
(zero or more) precede `O:` (exactly one), which precedes `d:`. The `O:`
event always carries the schema-validated complete object — clients can
trust it as the canonical final result.

**Forward-compat (EC-11):** unknown codes are silently ignored by the
shared parser. This lets us add new codes (e.g., `r:` for reasoning) in
future versions without breaking older clients.

## Examples

Text-only response:
```
0:"Hello"
0:" there"
d:{"finishReason":"end_turn"}
```

With tool call:
```
0:"Let me check that."
9:{"toolCallId":"tu-abc","toolName":"current_time"}
a:{"toolCallId":"tu-abc","result":"2026-05-17T15:00:00Z"}
0:"It is now 15:00 UTC."
d:{"finishReason":"end_turn","usage":{"inputTokens":120,"outputTokens":35}}
```

Error mid-stream:
```
0:"Working on it"
3:"rate_limit"
```

## Frontend parsing pseudocode

```ts
const reader = response.body.getReader();
const decoder = new TextDecoder();
let buf = "";
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (line.length === 0) continue;
    const code = line[0];
    const json = line.slice(2); // skip "<code>:"
    const payload = JSON.parse(json);
    handleEvent(code, payload);
  }
}
```
