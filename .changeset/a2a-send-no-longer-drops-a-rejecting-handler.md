---
"@theokit/sdk": patch
---

`MessageBus.send` discarded the handler's promise. `MessageHandler` may return one and `request`
awaits it; only `send` dropped it, so a rejecting handler became an unhandled rejection — fatal
under Node's default `--unhandled-rejections=throw` — while `await bus.send(...)` resolved cleanly
and the sender learned nothing.

Fire-and-forget means the sender does not wait for the result. It does not mean nobody is told when
delivery fails. The rejection is now caught and reported, naming the target agent and the reason,
and `send` stays non-blocking.

`AgentMailbox.send` forwards into this path and is fixed with it.
