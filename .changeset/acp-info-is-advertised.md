---
"@theokit/acp": major
---

`AcpServerOptions.info` is now advertised in the `initialize` handshake, and two inert capability
fields are removed.

`info` was accepted, typed, and documented as advertised — and read by nothing. It is now sent as
`InitializeResponse.agentInfo`, the protocol slot that matches its shape. It is omitted when you do
not supply one: defaulting to this package's own metadata would label every agent as the adapter
serving it, and a name that is confidently wrong is worse for a host to display than one that is
absent.

**Breaking:** `AcpCapabilities.forkSession` and `AcpCapabilities.listSessions` are removed.
`AgentCapabilities` has no slot for either at `@agentclientprotocol/sdk@0.22.1` — neither name
appears in its schema — and neither gated anything: `session/fork` is refused unconditionally and
`session/list` is answered regardless. Setting them never did anything; removing them says so at
compile time.
