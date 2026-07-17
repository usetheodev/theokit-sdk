---
user-invocable: false
paths:
  - "**/*client*"
  - "**/*Client*"
description: TheoKit SDK low-level HTTP client — TheoKitClient (DEPRECATED; prefer the Agent façade)
---

# TheoKit Client

`TheoKitClient` is a browser-safe, zero-Node-dependency HTTP client (native
`fetch` + manual SSE parsing) for a legacy server-adapter contract.

> DEPRECATED since 2.x — the `@theokit/sdk/client` sub-path consumes a legacy
> server-adapter HTTP contract (`POST /agent/send`, `GET /agent/stream`) that the
> ecosystem no longer produces, and will be removed in the next major. For
> in-process runs use the `Agent` façade (`@theokit/sdk`); for HTTP, use the
> framework's typed `POST /api/agents/<name>` client. Reach for this only when
> maintaining an existing integration against the old contract.

```ts
import { TheoKitClient } from "@theokit/sdk/client";
import type { ClientOptions, SendResponse, StreamEvent } from "@theokit/sdk/client";
```

## Construct

The constructor takes `ClientOptions` — `baseUrl` (required), optional `basePath`
and `headers`.

```ts
const client = new TheoKitClient({
  baseUrl: "https://adapter.example.com",
  basePath: "/agent",                      // optional
  headers: { authorization: "Bearer …" },  // optional
});
```

## Send (one-shot)

`send(input)` POSTs and resolves a `SendResponse` (`{ status, output?, error? }`).

```ts
const res: SendResponse = await client.send("summarize the repo");
if (res.error) throw new Error(res.error);
console.log(res.status, res.output);
```

## Stream (SSE)

`stream(input)` returns an `AsyncGenerator<StreamEvent>`; each `StreamEvent` has a
`type` and an optional `text` (plus arbitrary extra fields).

```ts
for await (const event of client.stream("build the changelog")) {
  if (event.type === "text" && event.text) process.stdout.write(event.text);
}
```
