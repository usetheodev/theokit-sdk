---
"@theokit/sdk": patch
---

Security: the MCP OAuth token store now locks down its directory, and the shared permission gate stops refusing every store on Windows.

`setTokens` wrote through `atomicWriteJson`, whose parent-directory `mkdir` carries no mode, so `~/.theokit` was born 0775 under the common umask 002. The `chmod 600` on `mcp-tokens.json` then protects the wrong thing: write permission on a DIRECTORY is permission to unlink and recreate its contents, so another local user could replace the file wholesale — and the secret is a refresh token, so replacing it changes which account the agent authenticates as. The read path had no permission check at all, so the swap would be picked up silently.

The directory is created 0700 and `chmod`-ed unconditionally, because `mkdir`'s mode applies only at creation and the machines that need this fix already have the loose directory. Reads go through `assertSecureModes` — the same gate the credential file uses, deliberately the same implementation rather than a second dialect of the same rule.

Separately, `assertSecureModes` was unconditional and Windows has no POSIX mode bits: `statSync().mode` is synthetic there, so the gate refused every valid store and the credential path was unreadable on that platform. It now returns early on `win32`.

Behaviour change worth knowing: `getTokens` now THROWS `CredentialError` on a group- or world-writable store directory where it previously returned the tokens. That is intentional — returning them would hand back what may be an attacker's refresh token as if it were the user's — but a consumer catching nothing around `getTokens` will see the error surface. The fix on the operator side is `chmod 700 ~/.theokit`.
