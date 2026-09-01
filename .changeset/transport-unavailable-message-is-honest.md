---
"@theokit/sdk": patch
---

The "no transport" error no longer tells you to install a package that cannot exist.

When a provider declares an `apiMode` the SDK has no transport for, the thrown `ConfigurationError`
advised: *"Install a third-party transport plugin (`@theokit-transport-{apiMode}`)"*. There is no
plugin mechanism to install into — `registerTransport` and `transportRegistry` appear nowhere in the
package, and the only other mention of `theokit-transport` was a docblock describing that very
message. Someone could publish the package; nothing would load it.

The message now says transports are a built-in, closed set, and names all four of them —
`chat_completions`, `anthropic_messages`, `bedrock_anthropic`, `responses_api` — instead of two. The
`transport_unavailable` code is unchanged, so anything branching on `code` is unaffected.
