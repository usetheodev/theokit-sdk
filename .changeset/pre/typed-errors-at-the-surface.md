---
"@theokit/sdk": minor
---

Nine failures that used to arrive as a bare `Error` now carry a type and a code.

`docs/error-codes.md` says to branch on `code`, never on the message — messages carry context and
change with it. These nine gave you no code to branch on:

- `MessageBus.send` / `request` against an unregistered peer now reject with the new
  `A2APeerNotRegisteredError` (`a2a_peer_not_registered`), carrying `to`. The timeout branch of those
  same two methods was typed under #380; this was the branch above it.
- The ChatGPT provider's missing-credential path now throws `AuthenticationError`
  (`missing_credential`), matching the router path that handles the same condition.
- `createSkill`, `createTokenLimiter`, `defineSkillReadTool`, the two `Workflow` builder guards, and
  `Security.addPattern` now throw `ConfigurationError` with a code each.

Because `isTransientError` is `err instanceof TheokitAgentError && err.isRetryable`, a bare `Error`
was also permanently invisible to retry logic. These now answer the question.
